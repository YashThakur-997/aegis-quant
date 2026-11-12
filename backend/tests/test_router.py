import numpy as np
import pandas as pd
import pytest

pytest.importorskip("vectorbt")
from backend.core.router import RegimeStrategyRouter


def bars(count: int = 90) -> pd.DataFrame:
    close = pd.Series(np.linspace(100, 140, count) + np.sin(np.arange(count)))
    return pd.DataFrame({
        "open": close - 0.4,
        "high": close + 1.0,
        "low": close - 1.0,
        "close": close,
        "volume": 1_000_000,
    })


def test_future_prices_do_not_change_prior_signals():
    original = bars()
    changed = original.copy()
    changed.loc[70:, "close"] = changed.loc[70:, "close"] * 3

    original_entries, _ = RegimeStrategyRouter.strategy_signals(original, "TREND_MOMENTUM")
    changed_entries, _ = RegimeStrategyRouter.strategy_signals(changed, "TREND_MOMENTUM")

    pd.testing.assert_series_equal(original_entries.iloc[:70], changed_entries.iloc[:70])


def test_walk_forward_report_includes_cost_assumptions():
    report = RegimeStrategyRouter.walk_forward_validate(bars(), "TREND_MOMENTUM")

    assert report["evaluation_method"] == "expanding-window, next-bar execution"
    assert report["fee_bps"] == 10.0
    assert report["slippage_bps"] == 5.0
    assert report["validation_bars"] > 0
