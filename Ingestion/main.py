import asyncio
import sys
import os
import time
from models import init_db
from loader import AsyncMarketLoader
from Polymarket.GetMarkets import PolymarketExtractor
from Kalshi.GetMarkets import KalshiExtractor
from EmbendingMercados import MarketEmbedder
from Similaridade import MarketMatcher


# ==============================================================================
# PASSO 1: INGESTÃO (Async)
# ==============================================================================
async def step_1_ingestion():
    print("\n" + "="*60)
    print("📡 PASSO 1: INGESTÃO DE DADOS (Kalshi & Polymarket)")
    print("="*60)
    
    loader = AsyncMarketLoader()
    await loader.init()

    # --- Polymarket ---
    print("\n🔹 [1/2] Polymarket: Baixando tudo...")
    try:
        t0 = time.time()
        poly = PolymarketExtractor()
        df_poly = await poly.get_data(min_vol=100)
        print(f"   ↳ Download em {time.time()-t0:.2f}s. Salvando...")
        await loader.save_batch(df_poly, 'polymarket', chunk_size=1000)
        del df_poly
    except Exception as e:
        print(f"   ❌ Erro Polymarket: {e}")

    # --- Kalshi ---
    print("\n🔹 [2/2] Kalshi: Streaming...")
    try:
        kalshi = KalshiExtractor()
        total_kalshi = 0
        async for df_batch in kalshi.stream_data(min_vol=10, batch_size=1000):
            await loader.save_batch(df_batch, 'kalshi')
            total_kalshi += len(df_batch)
            print(f"   📦 Lote salvo! Total: {total_kalshi}")
        print(f"   ✅ Kalshi finalizada. Total: {total_kalshi}")
    except Exception as e:
        print(f"   ❌ Erro Kalshi: {e}")

    await loader.close()

# ==============================================================================
# PASSO 2: EMBEDDINGS (Sync)
# ==============================================================================
def step_2_embedding():
    print("\n" + "="*60)
    print("🧠 PASSO 2: GERAÇÃO DE EMBEDDINGS (Vetores)")
    print("="*60)
    
    embedder = MarketEmbedder()
    embedder.run()

# ==============================================================================
# PASSO 3: MATCHING (Sync)
# ==============================================================================
def step_3_matching():
    print("\n" + "="*60)
    print("🔎 PASSO 3: BUSCA DE SIMILARIDADE E RERANKING")
    print("="*60)
    
    matcher = MarketMatcher()
    # Ajuste os thresholds conforme necessário
    matcher.run(threshold_similarity=0.75, threshold_rerank=0.0)

# ==============================================================================
# ORQUESTRADOR PRINCIPAL
# ==============================================================================
async def pipeline():
    start_time = time.time()
    print("🚀 INICIANDO PIPELINE DE DADOS PREDICTION MARKETS")
    
    # 0. Garante que o banco existe
    await init_db()

    # 1. Roda Ingestão (Async)
    await step_1_ingestion()
    
    # Pausa técnica para o banco respirar/commits finalizarem
    time.sleep(2) 

    # 2. Roda Embeddings (Sync - roda numa thread separada ou direto pois é CPU bound)
    # Como não é async, chamamos direto.
    try:
        step_2_embedding()
    except Exception as e:
        print(f"❌ Falha no passo de Embeddings: {e}")

    time.sleep(1)

    # 3. Roda Matcher (Sync)
    try:
        step_3_matching()
    except Exception as e:
        print(f"❌ Falha no passo de Matching: {e}")

    elapsed = time.time() - start_time
    print(f"\n🏁 PIPELINE COMPLETO EM {elapsed/60:.2f} MINUTOS.")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    try:
        asyncio.run(pipeline())
    except KeyboardInterrupt:
        print("\n🛑 Pipeline interrompido pelo usuário.")