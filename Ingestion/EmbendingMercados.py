import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

# Carrega variáveis
load_dotenv()

# Configuração DB
db_url = os.getenv("DATABASE_URL")
if not db_url:
    raise ValueError("DATABASE_URL não definida.")

if "+asyncpg" in db_url:
    db_url = db_url.replace("+asyncpg", "+psycopg2")

engine = create_engine(db_url)

class MarketEmbedder:
    def __init__(self):
        print("\n🧠 Inicializando Motor de Embeddings...")
        # device="cuda" se tiver placa de vídeo, senão "cpu"
        self.model = SentenceTransformer("BAAI/bge-m3", device="cpu")
        print("   ✅ Modelo BAAI/bge-m3 carregado.")

    def fetch_pending_markets(self):
        """Busca TODOS os mercados pendentes (SEM LIMIT)"""
        print(f"🔍 Buscando novos mercados (Delta)...")
        
        # REMOVIDO O LIMIT: Traz tudo que falta processar
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
        count = len(df)
        print(f"💾 Inserindo {count} vetores no banco de uma vez...")
        
        data_to_insert = []
        
        # --- SEGURANÇA MÁXIMA CONTRA ERRO DE ÍNDICE ---
        # O zip junta a linha do DF com o vetor correspondente na ordem exata.
        # Não importa se o índice do DF é 500, 1000 ou 50000.
        for (_, row), vector in zip(df.iterrows(), embeddings):
            
            data_to_insert.append({
                "market_id": row['id'],
                "embedding": vector.tolist() 
            })
            
        # Insere tudo numa transação só
        with engine.begin() as conn:
            stmt = text("""
                INSERT INTO core.market_embeddings (market_id, embedding)
                VALUES (:market_id, :embedding)
            """)
            conn.execute(stmt, data_to_insert)
        
        print("   ✅ Inserção concluída com sucesso.")

    def run(self):
        # 1. Busca TUDO
        df = self.fetch_pending_markets()
        
        if df.empty:
            print("✨ Nenhum mercado novo para vetorizar.")
            return

        print(f"🚀 {len(df)} mercados encontrados. Gerando vetores (isso pode demorar um pouco)...")

        # 2. Gera Embeddings
        # batch_size=32 aqui é interno da IA (para não estourar RAM do processador), 
        # mas ele devolve a lista completa no final.
        texts = df.apply(self.generate_blob, axis=1).tolist()
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=True, batch_size=32)

        # 3. Salva
        self.save_all(df, embeddings)

        print("🏁 Processo finalizado.")

if __name__ == "__main__":
    embedder = MarketEmbedder()
    embedder.run()