import os
import logging
import asyncio
import aiohttp
import pandas as pd
import sys


current_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.dirname(current_dir)
project_root = os.path.dirname(src_dir)
if project_root not in sys.path:
    sys.path.append(project_root)
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger("KalshiExtract")

class KalshiExtractor:
    def __init__(self):
        from Kalshi.utils import KalshiAuth
        from dotenv import load_dotenv
        load_dotenv()
        self.base_url = "https://api.elections.kalshi.com"
        k_id = os.getenv("KALSHI_PROD_KEYID")
        k_file = os.getenv("KALSHI_API_KEY")
        if not k_id or not k_file:
            raise ValueError("⚠️  Faltam credenciais no .env")
        if not os.path.isabs(k_file):
            k_file = os.path.join(os.getcwd(), k_file)
            
        self.auth = KalshiAuth(k_id, k_file)

    async def _get_series_map(self, session) -> dict:
        path = "/trade-api/v2/series"
        headers = self.auth.get_headers("GET", path)
        try:
            async with session.get(self.base_url + path, headers=headers) as resp:
                if resp.status != 200: return {}
                data = await resp.json()
                return {
                    s['ticker']: {
                        'category': s.get('category', 'Uncategorized'),
                        'tags': s.get('tags', []),
                        'title': s.get('title')
                    }
                    for s in data.get('series', [])
                }
        except Exception: return {}

    async def stream_data(self, min_vol=100, batch_size=5000):
        buffer_rows = []
        cursor = None
        
        async with aiohttp.ClientSession() as session:

            series_map = await self._get_series_map(session)
            
            while True:
                path = "/trade-api/v2/markets"
                params = {"limit": 1000, "status": "open"} # Use 'active' para a V2
                if cursor: params["cursor"] = cursor

                headers = self.auth.get_headers("GET", path)
                try:
                    async with session.get(self.base_url + path, headers=headers, params=params) as resp:
                        if resp.status != 200: 
                            print(f"Erro API: {resp.status}")
                            break
                        
                        data = await resp.json()
                        markets = data.get('markets', [])
                        cursor = data.get('cursor')
                        
                        if not markets: break

                        for m in markets:
                            
                            if m.get('mve_collection_ticker'): continue
                            ticker = m.get('ticker', '')
                            evt_ticker = m.get('event_ticker', '')
                            if 'KXMV' in ticker or 'KXMV' in evt_ticker: continue

                            series_code = evt_ticker.split('-')[0] if '-' in evt_ticker else evt_ticker
                            parent_data = series_map.get(series_code, {})
                            
                            raw_outcome = m.get('subtitle') or m.get('yes_sub_title') or "Generic"
                            specific_outcome = raw_outcome.split('::')[0].strip()
                            
                            buffer_rows.append({
                                "Category": parent_data.get('category') or m.get('category') or "Misc",
                                "Market_Title": m.get('title'),
                                "Specific_Outcome": specific_outcome,
                                "Start_Date": m.get('open_time'),
                                "End_Date": m.get('expiration_time'),
                             #   "Volume": vol, 
                                "Ticker": ticker,
                                "Status": "open",
                                "Token_Yes": None,
                                "Token_No": None
                            })

                        print(f"⚡ Coletando: {len(buffer_rows)} / {batch_size}...", end='\r')


                        if len(buffer_rows) >= batch_size:
                            df_batch = pd.DataFrame(buffer_rows)
                            for c in ['Start_Date', 'End_Date']:
                                df_batch[c] = pd.to_datetime(df_batch[c], errors='coerce', utc=True)
                            
                            yield df_batch
                            
                            buffer_rows = [] 

                        if not cursor: break
                        await asyncio.sleep(0.05)

                except Exception as e:
                    logger.error(f"Erro no loop: {e}")
                    break
        if buffer_rows:
            df_final = pd.DataFrame(buffer_rows)
            for c in ['Start_Date', 'End_Date']:
                df_final[c] = pd.to_datetime(df_final[c], errors='coerce', utc=True)
            yield df_final