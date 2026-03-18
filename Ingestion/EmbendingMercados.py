import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    raise ValueError("DATABASE_URL não definida.")

if "+asyncpg" in db_url:
    db_url = db_url.replace("+asyncpg", "+psycopg2")

engine = create_engine(db_url)

class MarketEmbedder:
    def __init__(self):
        self.model = SentenceTransformer("BAAI/bge-m3", device="cpu")

    def fetch_pending_markets(self):
        sql = text("""
            SELECT 
                m.id, 
                m.title, 
                m.specific_outcome 
            FROM core.markets m
            LEFT JOIN core.market_embeddings e ON m.id = e.market_id
            WHERE e.market_id IS NULL 
        """)
        
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
        
        return df

    def generate_blob(self, row):
        title = str(row['title']).strip()
        outcome = str(row['specific_outcome']).strip() if row['specific_outcome'] else ""
        return f"{title} {outcome}".strip()

    def save_all(self, df, embeddings):
        data_to_insert = []
        for (_, row), vector in zip(df.iterrows(), embeddings):   
            data_to_insert.append({
                "market_id": row['id'],
                "embedding": vector.tolist() 
            })
            
        with engine.begin() as conn:
            stmt = text("""
                INSERT INTO core.market_embeddings (market_id, embedding)
                VALUES (:market_id, :embedding)
            """)
            conn.execute(stmt, data_to_insert)

    def run(self):
        df = self.fetch_pending_markets()

        if df.empty:
            return None

        texts = df.apply(self.generate_blob, axis=1).tolist()
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=True, batch_size=32)
        self.save_all(df, embeddings)
