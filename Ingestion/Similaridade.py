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
        print("\n🔎 Inicializando Matcher Incremental...")
        # Cross-Encoder: O "Juiz" que dá a nota final de precisão
        print("   ├─ Carregando Reranker (BAAI/bge-reranker-v2-m3)...")
        self.reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", device="cpu") 
        # Se tiver GPU, mude device="cuda"
        print("   └─ Pronto.")

    def get_existing_pairs(self):
        """
        Lógica de Exclusão:
        Busca TODOS os pares que já processamos antes (candidatos ou ativos)
        para não gastar tempo re-analisando.
        """
        print("🛡️  Carregando lista negra (pares já existentes)...")
        with engine.connect() as conn:
            # 1. Pares que já são candidatos
            candidates = conn.execute(text("SELECT poly_id, kalshi_id FROM core.market_match_candidates")).fetchall()
            # 2. Pares que já foram validados/ativos
            active = conn.execute(text("SELECT poly_id, kalshi_id FROM core.matched_markets")).fetchall()
        
        # Cria um SET de tuplas para busca instantânea O(1)
        # Formato: {(poly_id, kalshi_id), ...}
        existing = set(candidates) | set(active)
        print(f"   └─ {len(existing)} pares ignorados (já processados).")
        return existing

    def load_data(self):
        """Carrega Vetores + Textos (necessário para o Reranker)"""
        print("📥 Baixando dados do banco...")
        
        # Query otimizada: Traz Vetor (para fase 1) e Texto (para fase 2)
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
            
        # Converte a coluna embedding (string/lista) para numpy array
        # O Pandas as vezes traz como string se o driver não converter
        if isinstance(df['embedding'].iloc[0], str):
            df['embedding'] = df['embedding'].apply(eval)
            
        return df

    def run(self, threshold_similarity=0.70, threshold_rerank=0.5):
        # 1. Carrega Dados
        df = self.load_data()
        existing_pairs = self.get_existing_pairs()

        # Separa DataFrames
        # Assumindo: Kalshi=1, Polymarket=2 (conforme seus inserts anteriores)
        df_kalshi = df[df['platform_id'] == 4].copy().reset_index(drop=True)
        df_poly   = df[df['platform_id'] == 3].copy().reset_index(drop=True)

        if df_kalshi.empty or df_poly.empty:
            print("❌ Dados insuficientes para match (uma das plataformas está vazia).")
            return

        print(f"📊 Comparando: {len(df_kalshi)} Kalshi x {len(df_poly)} Poly")

        # 2. Converte para Tensores (PyTorch) para cálculo rápido
        # Stack empilha a lista de arrays em uma matriz gigante
        emb_k = torch.tensor(np.stack(df_kalshi['embedding'].values))
        emb_p = torch.tensor(np.stack(df_poly['embedding'].values))

        # 3. FASE 1: Similaridade de Cosseno (Bi-Encoder)
        # Isso é muito rápido. Retorna matriz de Scores.
        print("⚡ Calculando similaridade vetorial...")
        cosine_scores = util.cos_sim(emb_k, emb_p)

        # Filtra pares acima do threshold básico (ex: 0.70)
        # Retorna índices: (indices_k, indices_p)
        pairs = torch.where(cosine_scores >= threshold_similarity)
        indices_k = pairs[0].tolist()
        indices_p = pairs[1].tolist()
        
        print(f"   └─ {len(indices_k)} pares potenciais encontrados (Pré-filtro).")

        # 4. FASE 2: Filtragem e Preparação para Rerank
        rerank_input = []
        batch_ids = [] # Guarda (k_id, p_id) para usar depois

        for k_idx, p_idx in zip(indices_k, indices_p):
            k_row = df_kalshi.iloc[k_idx]
            p_row = df_poly.iloc[p_idx]
            
            k_id = int(k_row['id'])
            p_id = int(p_row['id'])

            # 🛑 FILTRO DE DUPLICIDADE (Incremental)
            if (p_id, k_id) in existing_pairs:
                continue

            # Monta texto para o Reranker
            # Formato: [Query, Candidate]
            text_k = f"{k_row['title']} {k_row['specific_outcome'] or ''}"
            text_p = f"{p_row['title']} {p_row['specific_outcome'] or ''}"
            
            rerank_input.append([text_k, text_p])
            batch_ids.append((k_id, p_id, cosine_scores[k_idx][p_idx].item()))

        if not rerank_input:
            print("✨ Todos os pares potenciais já foram processados anteriormente.")
            return

        # 5. FASE 3: Reranking (Precisão Extrema)
        print(f"🧠 Reranking {len(rerank_input)} novos pares...")
        scores = self.reranker.predict(rerank_input, show_progress_bar=True)

        # 6. Salva no Banco
        print("💾 Salvando melhores matches...")
        matches_to_save = []
        
        for idx, score in enumerate(scores):
            # Sigmoide opcional: score = 1 / (1 + np.exp(-score)) se quiser 0-1
            # Mas o BGE-Reranker v2 retorna scores brutos. >0 é bom.
            
            if score > threshold_rerank: # Se passou na prova final
                k_id, p_id, sim_score = batch_ids[idx]
                
                matches_to_save.append({
                    "poly_id": p_id,
                    "kalshi_id": k_id,
                    "score_similarity": float(sim_score),
                    "score_reranker": float(score)
                    # Não mandamos titulos, o trigger do banco preenche!
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
            print(f"✅ {len(matches_to_save)} novos candidatos inseridos!")
        else:
            print("📉 Nenhum par passou no critério do Reranker.")

if __name__ == "__main__":
    matcher = MarketMatcher()
    # threshold_rerank=0.0: O modelo BGE retorna scores negativos para ruim e positivos para bom.
    # > 0 é um bom ponto de corte inicial. > 1.0 é match quase certo.
    matcher.run(threshold_similarity=0.75, threshold_rerank=0.0)