import asyncio
import sys
import os
import time
from Ingestion.models import init_db
from Ingestion.loader import AsyncMarketLoader
from Polymarket.GetMarkets import PolymarketExtractor
from Kalshi.GetMarkets import KalshiExtractor

async def main():
    print("🏁 INICIANDO PIPELINE HÍBRIDO")
    
    await init_db()
    loader = AsyncMarketLoader()
    await loader.init()


    try:
        t0 = time.time()
        poly = PolymarketExtractor()
        
        # Baixa tudo para a memória (rápido)
        df_poly = await poly.get_data(min_vol=100) 
        
        print(f"   ↳ Download concluído em {time.time()-t0:.2f}s. Salvando no banco...")
        
        await loader.save_batch(df_poly, 'polymarket', chunk_size=1000)
        del df_poly 
        
    except Exception as e:
        print(f"   ❌ Erro Polymarket: {e}")
#
    # =========================================================
    # 2. KALSHI (Modo: Streaming / Página por Página)
    # =========================================================
    print("\n🔹 [2/2] Kalshi: Baixando (Lotes de 5k)...")
    try:
        kalshi = KalshiExtractor()
        total_kalshi = 0
        
        # min_vol=100: Filtra lixo
        # batch_size=5000: Só insere no banco a cada 5000 mercados coletados
        async for df_batch in kalshi.stream_data(min_vol=10, batch_size=1000):
            
            await loader.save_batch(df_batch, 'kalshi')
            
            total_kalshi += len(df_batch)
            print(f"   📦 Lote inserido! Total Acumulado: {total_kalshi}")

        print(f"\n   ✅ Kalshi finalizada. Total: {total_kalshi}")

    except Exception as e:
        print(f"\n   ❌ Erro Kalshi: {e}")

    await loader.close()
    print("\n🏁 Processo Finalizado.")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())