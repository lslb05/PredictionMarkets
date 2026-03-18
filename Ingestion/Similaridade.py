import os
import pandas as pd
import numpy as np
import torch
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from sentence_transformers import CrossEncoder, util

# Carrega ambiente
load_dotenv()
db_url = os.getenv("DATABASE_URL")
if "+asyncpg" in db_url: db_url = db_url.replace("+asyncpg", "+psycopg2")
engine = create_engine(db_url)

class MarketMatcher:
    def __init__(self):
        self.reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", device="cpu")

    def get_existing_pairs(self):
        with engine.connect() as conn:
            candidates = conn.execute(text("SELECT poly_id, kalshi_id FROM core.market_match_candidates")).fetchall()
            active = conn.execute(text("SELECT poly_id, kalshi_id FROM core.matched_markets")).fetchall()
        existing = set(candidates) | set(active)
        return existing

    def load_data(self):
        sql = text("""
            SELECT 
                m.id, 
                m.platform_id,
                m.title,
                m.specific_outcome,
                e.embedding
            FROM core.markets m
            JOIN core.market_embeddings e ON m.id = e.market_id
            where  m.status in ('OPEN' ,'open')
            
        """)
        
        with engine.connect() as conn:
            df = pd.read_sql(sql, conn)
            
        if isinstance(df['embedding'].iloc[0], str):
            df['embedding'] = df['embedding'].apply(eval)
            
        return df

    def run(self, threshold_similarity=0.70, threshold_rerank=0.5):
        df = self.load_data()
        existing_pairs = self.get_existing_pairs()

        df_kalshi = df[df['platform_id'] == 4].copy().reset_index(drop=True)
        df_poly   = df[df['platform_id'] == 3].copy().reset_index(drop=True)

        if df_kalshi.empty or df_poly.empty:
            return

       
        emb_k = torch.tensor(np.stack(df_kalshi['embedding'].values))
        emb_p = torch.tensor(np.stack(df_poly['embedding'].values))
        cosine_scores = util.cos_sim(emb_k, emb_p)
        pairs = torch.where(cosine_scores >= threshold_similarity)
        indices_k = pairs[0].tolist()
        indices_p = pairs[1].tolist()
        rerank_input = []
        batch_ids = []

        for k_idx, p_idx in zip(indices_k, indices_p):
            k_row = df_kalshi.iloc[k_idx]
            p_row = df_poly.iloc[p_idx]
            
            k_id = int(k_row['id'])
            p_id = int(p_row['id'])

            if (p_id, k_id) in existing_pairs:
                continue

            text_k = f"{k_row['title']} {k_row['specific_outcome'] or ''}"
            text_p = f"{p_row['title']} {p_row['specific_outcome'] or ''}"
            
            rerank_input.append([text_k, text_p])
            batch_ids.append((k_id, p_id, cosine_scores[k_idx][p_idx].item()))

        if not rerank_input:
            return


        scores = self.reranker.predict(rerank_input, show_progress_bar=True)
        matches_to_save = []
        
        for idx, score in enumerate(scores):
            if score > threshold_rerank:
                k_id, p_id, sim_score = batch_ids[idx]
                
                matches_to_save.append({
                    "poly_id": p_id,
                    "kalshi_id": k_id,
                    "score_similarity": float(sim_score),
                    "score_reranker": float(score)
                })

        if matches_to_save:
            with engine.begin() as conn:
                stmt = text("""
                    INSERT INTO core.market_match_candidates 
                    (poly_id, kalshi_id, score_similarity, score_reranker)
                    VALUES (:poly_id, :kalshi_id, :score_similarity, :score_reranker)
                    ON CONFLICT (poly_id, kalshi_id) DO NOTHING
                """)
                conn.execute(stmt, matches_to_save)
            print(f"{len(matches_to_save)} novos candidatos inseridos!")
        else:
            print("Nenhum par passou no critério do Reranker.")

if __name__ == "__main__":
    matcher = MarketMatcher()
    matcher.run(threshold_similarity=0.75, threshold_rerank=0.0)