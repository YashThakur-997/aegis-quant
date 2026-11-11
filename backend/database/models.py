from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
import datetime

Base = declarative_base()

class TradeJournalModel(Base):
    __tablename__ = "trade_journals"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(String, unique=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    action = Column(String)  # BUY, SELL, HOLD
    ticker = Column(String)
    shares = Column(Integer)
    allocated_capital = Column(Float)
    stop_loss_price = Column(Float)
    regime = Column(String)
    conviction = Column(Float)
    plain_language_reasoning = Column(Text)
    bull_catalysts = Column(Text)  # Stored as JSON or comma-separated string
    bear_risks = Column(Text)
    status = Column(String)  # EXECUTED, REJECTED, KILLED