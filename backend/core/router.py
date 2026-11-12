import logging

import numpy as np
import pandas as pd
import vectorbt as vbt
from hmmlearn.hmm import GaussianHMM
from typing import Tuple, Dict, Any

vbt.settings.array_wrapper['freq'] = '1D'

logger = logging.getLogger(__name__)

class RegimeStrategyRouter:
    """
    Swimlane 2: Regime & Strategy Router
    Classifies market regimes using HMM and ADX/VIX features, 
    and validates strategies against Buy-and-Hold using VectorBT[cite: 3, 7].
    """
    def __init__(self, n_regimes: int = 3, min_samples_per_regime: int = 10):
        self.n_regimes = n_regimes
        self.min_samples_per_regime = min_samples_per_regime
        self.hmm_model = GaussianHMM(n_components=n_regimes, covariance_type="full", n_iter=100, random_state=42)
        self.is_fitted = False

    def extract_regime_features(self, df: pd.DataFrame) -> np.ndarray:
        """Extracts log returns, rolling volatility, and price momentum features for HMM training."""
        df = df.copy()
        df['log_return'] = np.log(df['close'] / df['close'].shift(1))
        df['volatility_20'] = df['log_return'].rolling(window=20).std()
        
        # Trend spread proxy (MA20 vs MA50)
        ma_fast = df['close'].rolling(window=20).mean()
        ma_slow = df['close'].rolling(window=50).mean()
        df['trend_spread'] = (ma_fast - ma_slow) / ma_slow

        # Clean NaN/Inf values
        features = df[['log_return', 'volatility_20', 'trend_spread']].replace([np.inf, -np.inf], np.nan).fillna(0.0).values
        return features

    def _fit_model(self, features: np.ndarray) -> None:
        """Fits the HMM, falling back to a diagonal covariance if the full one is singular."""
        for cov_type in ("full", "diag"):
            model = GaussianHMM(
                n_components=self.n_regimes,
                covariance_type=cov_type,
                n_iter=100,
                random_state=42,
            )
            try:
                model.fit(features)
            except (ValueError, FloatingPointError, np.linalg.LinAlgError) as exc:
                logger.warning("HMM fit failed (covariance_type=%s): %s", cov_type, exc)
                continue
            self.hmm_model = model
            self.is_fitted = True
            return
        logger.warning("HMM fit failed for all covariance types; falling back to heuristic regime.")

    @staticmethod
    def _heuristic_regime(features: np.ndarray) -> str:
        """Deterministic regime classification used when the HMM cannot be fitted."""
        volatility = features[:, 1]
        trend = features[:, 2]
        latest_vol = float(volatility[-1]) if volatility.size else 0.0
        median_vol = float(np.median(volatility[volatility > 0])) if np.any(volatility > 0) else 0.0

        if median_vol > 0 and latest_vol > 2.0 * median_vol:
            return "High-Vol Shock"
        if trend.size and float(trend[-1]) > 0:
            return "Trending Bull/Bear"
        return "Mean-Reverting Chop"

    def fit_predict_regime(self, df: pd.DataFrame) -> Tuple[str, np.ndarray]:
        """Trains or applies the HMM classifier to identify the current market regime."""
        features = self.extract_regime_features(df)

        min_samples = self.n_regimes * self.min_samples_per_regime
        if features.shape[0] < min_samples:
            logger.warning(
                "Insufficient data to fit HMM (%s rows, need >= %s); using heuristic regime.",
                features.shape[0], min_samples,
            )
            return self._heuristic_regime(features), np.array([], dtype=int)

        if not self.is_fitted:
            self._fit_model(features)

        if not self.is_fitted:
            return self._heuristic_regime(features), np.array([], dtype=int)

        hidden_states = self.hmm_model.predict(features)
        latest_state = int(hidden_states[-1])

        # HMM state IDs have no stable semantic ordering. Use its fitted state as a
        # diagnostic, while route names come from observable volatility/trend features.
        logger.debug("Latest fitted HMM state: %s", latest_state)
        return self._heuristic_regime(features), hidden_states

    @staticmethod
    def strategy_for_regime(regime: str) -> str:
        """Map each observed regime to a deterministic, explainable policy."""
        return {
            "Trending Bull/Bear": "TREND_MOMENTUM",
            "Mean-Reverting Chop": "MEAN_REVERSION",
            "High-Vol Shock": "CAPITAL_PRESERVATION",
        }.get(regime, "CAPITAL_PRESERVATION")

    @staticmethod
    def calculate_atr(df: pd.DataFrame, window: int = 14) -> float:
        """Compute ATR using only completed bars available at decision time."""
        high = pd.to_numeric(df["high"], errors="coerce")
        low = pd.to_numeric(df["low"], errors="coerce")
        previous_close = pd.to_numeric(df["close"], errors="coerce").shift(1)
        true_range = pd.concat(
            [high - low, (high - previous_close).abs(), (low - previous_close).abs()], axis=1
        ).max(axis=1)
        atr = true_range.rolling(window=window, min_periods=window).mean().iloc[-1]
        return float(atr) if pd.notna(atr) else 0.0

    @staticmethod
    def _rsi(close: pd.Series, window: int = 14) -> pd.Series:
        delta = close.diff()
        gains = delta.clip(lower=0).rolling(window=window, min_periods=window).mean()
        losses = (-delta.clip(upper=0)).rolling(window=window, min_periods=window).mean()
        rs = gains / losses.replace(0, np.nan)
        return 100 - (100 / (1 + rs))

    @classmethod
    def strategy_signals(cls, df: pd.DataFrame, strategy: str) -> Tuple[pd.Series, pd.Series]:
        """Generate next-bar signals without reading future bars."""
        close = pd.to_numeric(df["close"], errors="coerce")
        entries = pd.Series(False, index=df.index)
        exits = pd.Series(False, index=df.index)
        if strategy == "TREND_MOMENTUM":
            fast = close.rolling(10, min_periods=10).mean()
            slow = close.rolling(30, min_periods=30).mean()
            entries = (fast > slow) & (fast.shift(1) <= slow.shift(1))
            exits = (fast < slow) & (fast.shift(1) >= slow.shift(1))
        elif strategy == "MEAN_REVERSION":
            rsi = cls._rsi(close)
            entries = rsi < 30
            exits = rsi > 55
        # CAPITAL_PRESERVATION deliberately stays flat.
        # Signals become executable on the following bar, avoiding same-close fills.
        return entries.shift(1, fill_value=False), exits.shift(1, fill_value=False)

    @classmethod
    def deterministic_action(cls, df: pd.DataFrame, strategy: str) -> str:
        entries, _ = cls.strategy_signals(df, strategy)
        return "BUY" if bool(entries.iloc[-1]) else "HOLD"

    @classmethod
    def walk_forward_validate(
        cls,
        df: pd.DataFrame,
        strategy: str,
        fee_rate: float = 0.001,
        slippage: float = 0.0005,
    ) -> Dict[str, Any]:
        """Run a next-bar, expanding-window out-of-sample validation against buy-and-hold."""
        close_prices = pd.to_numeric(df["close"], errors="coerce").dropna()
        if len(close_prices) < 61:
            return {
                "strategy": strategy,
                "validation_status": "INSUFFICIENT_HISTORY",
                "evaluation_method": "expanding-window, next-bar execution",
                "minimum_bars": 61,
            }

        entries, exits = cls.strategy_signals(df.loc[close_prices.index], strategy)
        # The first half is historical context; scoring starts only after it.
        validation_start = max(30, len(close_prices) // 2)
        entries.iloc[:validation_start] = False
        exits.iloc[:validation_start] = False
        tested_prices = close_prices.iloc[validation_start:]
        tested_entries = entries.iloc[validation_start:]
        tested_exits = exits.iloc[validation_start:]
        portfolio = vbt.Portfolio.from_signals(
            tested_prices, tested_entries, tested_exits, init_cash=10000.0,
            fees=fee_rate, slippage=slippage,
        )
        benchmark_entries = pd.Series(False, index=tested_prices.index)
        benchmark_entries.iloc[0] = True
        benchmark = vbt.Portfolio.from_signals(
            tested_prices, benchmark_entries, pd.Series(False, index=tested_prices.index),
            init_cash=10000.0, fees=fee_rate, slippage=slippage,
        )

        def finite(value: float) -> Any:
            value = round(float(value), 2)
            return value if np.isfinite(value) else None

        strategy_return = float(portfolio.total_return() * 100)
        benchmark_return = float(benchmark.total_return() * 100)
        return {
            "strategy": strategy,
            "evaluation_method": "expanding-window, next-bar execution",
            "validation_start_bar": validation_start,
            "validation_bars": len(tested_prices),
            "fee_bps": round(fee_rate * 10000, 1),
            "slippage_bps": round(slippage * 10000, 1),
            "strategy_total_return_pct": finite(strategy_return),
            "benchmark_total_return_pct": finite(benchmark_return),
            "strategy_sharpe_ratio": finite(portfolio.sharpe_ratio()),
            "benchmark_sharpe_ratio": finite(benchmark.sharpe_ratio()),
            "strategy_max_drawdown_pct": finite(portfolio.max_drawdown() * 100),
            "validation_status": "PASSED" if strategy_return >= benchmark_return else "WARNING_UNDERPERFORMING",
        }

    @classmethod
    def validate_with_vectorbt(cls, df: pd.DataFrame, fast_window: int = 10, slow_window: int = 30) -> Dict[str, Any]:
        """Compatibility wrapper for callers; validation is now next-bar walk-forward."""
        return cls.walk_forward_validate(df, "TREND_MOMENTUM")
