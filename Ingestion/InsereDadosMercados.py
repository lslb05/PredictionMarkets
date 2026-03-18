import asyncio
import sys
import os
import time
from Ingestion.models import init_db
from Ingestion.loader import AsyncMarketLoader
from Polymarket.GetMarkets import PolymarketExtractor
from Kalshi.GetMarkets import KalshiExtractor

async def main():
    await init_db()
    loader = AsyncMarketLoader()
    await loader.init()

    try:
        t0 = time.time()
        poly = PolymarketExtractor()
        df_poly = await poly.get_data(min_vol=100)
        await loader.save_batch(df_poly, 'polymarket', chunk_size=1000)
        del df_poly
    except Exception as e:
        print(f"Erro Polymarket: {e}")
    try:
        kalshi = KalshiExtractor()
        total_kalshi = 0
        async for df_batch in kalshi.stream_data(min_vol=10, batch_size=1000):
            await loader.save_batch(df_batch, 'kalshi')
            total_kalshi += len(df_batch)
    except Exception as e:
        print(f"Erro Kalshi: {e}")

    await loader.close()
    print("End")
