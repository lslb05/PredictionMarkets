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


async def ingestion():
    loader = AsyncMarketLoader()
    await loader.init()

    print("\n🔹 [1/2] Polymarket")
    try:
        t0 = time.time()
        poly = PolymarketExtractor()
        df_poly = await poly.get_data(min_vol=100)
        await loader.save_batch(df_poly, 'polymarket', chunk_size=1000)
        del df_poly
    except Exception as e:
        print(f"Erro Poly: {e}")

    print("[2/2] Kalshi")
    try:
        kalshi = KalshiExtractor()
        total_kalshi = 0
        async for df_batch in kalshi.stream_data(min_vol=10, batch_size=1000):
            await loader.save_batch(df_batch, 'kalshi')
            total_kalshi += len(df_batch)
    except Exception as e:
        print(f"Erro Kalshi: {e}")

    await loader.close()

def embedding():    
    embedder = MarketEmbedder()
    embedder.run()

def matching():
    matcher = MarketMatcher()
    matcher.run(threshold_similarity=0.75, threshold_rerank=0.0)

async def pipeline():
    start_time = time.time()   
    await init_db()
    await ingestion()
    
    time.sleep(2) 
    try:
        embedding()
    except Exception as e:
        print(f"Erro Embeddings: {e}")

    time.sleep(1)
    try:
        matching()
    except Exception as e:
        print(f"Erro Matching: {e}")

    print(f"Finished in {(time.time() - start_time)/60:.2f} MINUTOS.")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    try:
        asyncio.run(pipeline())
    except Exception as e:
        print(f"Erro no pipeline: {e}")