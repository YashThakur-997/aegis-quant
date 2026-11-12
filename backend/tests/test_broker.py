from backend.core.broker import AlpacaSandboxExecution


def test_offline_broker_is_explicitly_simulated(monkeypatch):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    broker = AlpacaSandboxExecution()

    result = broker.execute_paper_order("NVDA", 3, "BUY", 100.0, 120.0)

    assert result["success"] is True
    assert result["mode"] == "SIMULATED"
    assert result["status"] == "SIMULATED_NOT_SUBMITTED"
    assert result["order_id"] is None
    assert result["protective_stop_attached"] is True


def test_mock_kill_switch_cancellation_is_a_noop(monkeypatch):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    broker = AlpacaSandboxExecution()

    result = broker.cancel_open_orders()

    assert result == {"mode": "SIMULATED", "attempted": 0, "cancelled": 0, "failures": []}


def test_paper_order_uses_bracket_stop(monkeypatch):
    class FakeOrder:
        id = "entry-1"
        status = "accepted"
        legs = []

    class FakeClient:
        def submit_order(self, order_data):
            self.order_data = order_data
            return FakeOrder()

    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    broker = AlpacaSandboxExecution()
    client = FakeClient()
    broker.client = client

    result = broker.execute_paper_order("NVDA", 3, "BUY", 100.0, 120.0)

    assert result["mode"] == "PAPER_ALPACA"
    assert result["protective_stop_attached"] is True
    assert float(client.order_data.stop_loss.stop_price) == 100.0
    assert float(client.order_data.take_profit.limit_price) == 120.0


def test_paper_kill_switch_cancels_each_open_order(monkeypatch):
    class Order:
        def __init__(self, identifier):
            self.id = identifier

    class FakeClient:
        def __init__(self):
            self.cancelled = []

        def get_orders(self, filter):
            return [Order("a"), Order("b")]

        def cancel_order_by_id(self, identifier):
            self.cancelled.append(identifier)

    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    broker = AlpacaSandboxExecution()
    client = FakeClient()
    broker.client = client

    result = broker.cancel_open_orders()

    assert result["attempted"] == 2
    assert result["cancelled"] == 2
    assert client.cancelled == ["a", "b"]
