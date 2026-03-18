import pandas as pd
from sqlalchemy import text
import os

from sqlalchemy.dialects.postgresql import insert
from Ingestion.models import Market, get_engine 

class AsyncMarketLoader:
    def __init__(self):
        self.engine = None
        self.platform_map = {}

    async def init(self):
        self.engine = await get_engine()
        await self._load_platform_ids()

    async def _load_platform_ids(self):
        try:
            async with self.engine.connect() as conn:
                result = await conn.execute(text("SELECT slug, id FROM core.platforms"))
                self.platform_map = {row.slug: row.id for row in result}
        except Exception as e:
            print(f"Erro plataforma: {e}")

    async def save_batch(self, df: pd.DataFrame, source_slug: str, chunk_size=200):
        if df.empty:
            return

        platform_id = self.platform_map.get(source_slug)
        total_rows = len(df)
                
        for i in range(0, total_rows, chunk_size):
            df_chunk = df.iloc[i : i + chunk_size]
            
            try:
                async with self.engine.begin() as conn:
                    records = []
                    for _, row in df_chunk.iterrows():
                        start_raw = row.get('Start_Date')
                        end_raw = row.get('End_Date')
                        
                        start_clean = None if pd.isna(start_raw) else start_raw
                        end_clean = None if pd.isna(end_raw) else end_raw

                        exec_data = {}
                        if source_slug == 'polymarket':
                            exec_data = {"token_yes": row.get('Token_Yes'), "token_no": row.get('Token_No')}
                        elif source_slug == 'kalshi':
                            exec_data = {"ticker": row.get('Ticker')}

                        cat_str = str(row.get('Category', 'Uncategorized'))[:100]
                        title_str = str(row['Market_Title'])
                        outcome_str = str(row.get('Specific_Outcome', ''))[:255]

                        records.append({
                            "platform_id": platform_id,
                            "external_id": str(row['Ticker']),
                            "title": title_str,
                            "category": cat_str,
                            "specific_outcome": outcome_str,
                            "start_date": start_clean,
                            "end_date": end_clean,
                            "status": row.get('Status', 'OPEN'),
                            "execution_data": exec_data
                        })
                    
                    stmt = insert(Market).values(records)
                    upsert_stmt = stmt.on_conflict_do_update(
                        index_elements=['platform_id', 'external_id'],
                        set_={
                            'status': stmt.excluded.status,
                            'execution_data': stmt.excluded.execution_data,
                            'end_date': stmt.excluded.end_date
                        }
                    )
                    await conn.execute(upsert_stmt)
            except Exception as e:
                print(f"Erro no lote {i} a {i+chunk_size}: {e}")
                import traceback
                traceback.print_exc()

        print(f"{source_slug.capitalize()}: End")
    
    async def close(self):
        if self.engine: await self.engine.dispose()