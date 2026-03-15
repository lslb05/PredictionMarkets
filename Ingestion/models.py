import os
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine
from dotenv import load_dotenv

load_dotenv()

Base = declarative_base()

class Market(Base):
    __tablename__ = 'markets'
    __table_args__ = (
        UniqueConstraint('platform_id', 'external_id', name='markets_platform_id_external_id_key'),
        {"schema": "core"}
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    platform_id = Column(Integer, ForeignKey("core.platforms.id", ondelete="CASCADE"), nullable=False)
    external_id = Column(String(255), nullable=False)
    title = Column(Text, nullable=False)
    category = Column(String(100))
    specific_outcome = Column(String(255))
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    status = Column(String(50), default='OPEN')
    execution_data = Column(JSONB)

async def get_engine():
    url = os.getenv("DATABASE_URL")
    if not url: raise ValueError("DATABASE_URL not found in .env")
    return create_async_engine(url, echo=False)

# ---------------------------------------------------------
# A FUNÇÃO QUE FALTAVA (init_db)
# ---------------------------------------------------------
async def init_db():
    """Cria o schema 'core' e a tabela 'markets' se não existirem."""
    engine = await get_engine()
    
    async with engine.begin() as conn:
        # 1. Cria o Schema 'core'
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS core;"))
        
        # 2. Cria as tabelas (markets) dentro do schema
        await conn.run_sync(Base.metadata.create_all)
        
    print("✅ Banco de core inicializado (Schema 'core' verificado).")
    await engine.dispose()