import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Reads DATABASE_URL from environment variables (set automatically via Docker Compose)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://aegis_user:aegis_password@postgres:5432/aegis_quant_db")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency generator for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()