from backend.core import risk_engine as risk_module
from backend.core.risk_engine import DeterministicRiskEngine


class FakeRedis:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = value

    def pipeline(self, transaction=True):
        return self

    def execute(self):
        return []


def test_daily_loss_limit_engages_lockout(monkeypatch):
    store = FakeRedis()
    monkeypatch.setattr(risk_module, "r", store)
    engine = DeterministicRiskEngine(initial_equity=10_000)

    result = engine.calculate_position_size(
        current_equity=10_000,
        current_daily_pnl=-0.025,
        buying_power=10_000,
        atr=2,
        price=100,
    )

    assert result["approved"] is False
    assert store.get("AEGIS_KILL_SWITCH_ENGAGED") == "TRUE"


def test_position_size_is_capped_by_risk_and_notional(monkeypatch):
    monkeypatch.setattr(risk_module, "r", FakeRedis())
    engine = DeterministicRiskEngine(initial_equity=10_000)

    result = engine.calculate_position_size(
        current_equity=10_000,
        current_daily_pnl=0,
        buying_power=50_000,
        atr=2,
        price=100,
    )

    assert result["approved"] is True
    assert result["risk_budget"] == 200
    assert result["shares"] == 10  # 10% notional cap, not the 50-risk-share limit
    assert result["actual_risk"] == 40
    assert result["stop_loss_price"] == 96
