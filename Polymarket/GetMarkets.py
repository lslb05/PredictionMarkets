import logging
import asyncio
import aiohttp
import json
import pandas as pd
import sys
import time
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()

class PolymarketExtractor:
    def __init__(self):
        self.url = "https://gamma-api.polymarket.com/events"
        self.headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        self.sem = asyncio.Semaphore(20) 
        self.PAGE_LIMIT = 100
        self.MAX_PAGES = 100 

    async def _fetch(self, session, offset):

        params = {
            "active": "true",
            "limit": str(self.PAGE_LIMIT),
            "offset": str(offset),
            "order": "volume",
            "ascending": "false"
        }
        async with self.sem:
            try:
                async with session.get(self.url, params=params, headers=self.headers) as resp:
                    return await resp.json() if resp.status == 200 else []
            except Exception: 
                return []

    def _extract_tokens(self, m: dict) -> dict:
        try:
            parse = lambda x: json.loads(x) if isinstance(x, str) else (x if isinstance(x, list) else [])
            ids = parse(m.get('clobTokenIds')) 
            outcomes = parse(m.get('outcomes'))           
            token_yes, token_no = None, None
            if len(ids) == 2:
                token_no, token_yes = ids[0], ids[1]           
            if len(ids) >= 2 and len(outcomes) == len(ids):
                for i, label in enumerate(outcomes):
                    lbl = str(label).lower().strip()
                    if lbl == 'yes': token_yes = ids[i]
                    elif lbl == 'no': token_no = ids[i]
            return {"yes": token_yes, "no": token_no}
        except: 
            return {"yes": None, "no": None}

    def _get_category(self, e: dict) -> str:
        def extract_label(item):
            if isinstance(item, dict): return item.get('label', '')
            if isinstance(item, str): return item
            return ''

        cat = e.get('category')
        if cat:
            val = extract_label(cat)
            if val: return val
        
        cats = e.get('categories')
        if cats and isinstance(cats, list) and len(cats) > 0:
            val = extract_label(cats[0])
            if val: return val

        tags = e.get('tags')
        if tags and isinstance(tags, list) and len(tags) > 0:
            val = extract_label(tags[0])
            if val: return val
        return "Uncategorized"


    def _extract_tags_list(self, e: dict) -> list:
        """Extrai lista de tags limpa."""
        raw_tags = e.get('tags', [])
        clean_tags = []
        if isinstance(raw_tags, list):
            for t in raw_tags:
                if isinstance(t, dict):
                    label = t.get('label')
                    if label: clean_tags.append(label)
                elif isinstance(t, str):
                    clean_tags.append(t)
        main_cat = e.get('category')
        if main_cat and isinstance(main_cat, str) and main_cat not in clean_tags:
             clean_tags.append(main_cat)
        return clean_tags

    def _determine_status(self, m: dict) -> str:
        is_closed = m.get('closed', False)
        is_active = m.get('active', True)
        if is_closed: return "CLOSED"
        elif is_active: return "OPEN"
        else: return "INACTIVE"

    async def get_data(self, min_vol=0) -> pd.DataFrame:      
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with aiohttp.ClientSession() as session:
            tasks = [self._fetch(session, i * self.PAGE_LIMIT) for i in range(self.MAX_PAGES)]
            raw_pages = await asyncio.gather(*tasks)
        
        data = []
        
        for page in raw_pages:
            if not page: continue
            for e in page:
                cat = self._get_category(e)
                tags_list = self._extract_tags_list(e)
                event_title = e.get('title')
                for m in e.get('markets', []):
                    end_date_str = m.get('endDate')
                    if not end_date_str: continue

                    try:
                        market_end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
                        if market_end_date < today: continue
                    except ValueError: continue

                    vol = float(m.get('volume') or 0)
                    if vol < min_vol: continue
                    
                    tokens = self._extract_tokens(m)
                    if not tokens['yes'] or not tokens['no']: continue

                    q = m.get('question')
                    outcome_name = "Binary Outcome" if q == event_title else q
                    
                    data.append({
                        "Ticker": m.get('conditionId'), 
                        "Market_Title": event_title,
                        "Category": cat,               
                        "Specific_Outcome": outcome_name,
                        "Start_Date": m.get('startDate'), 
                        "End_Date": m.get('endDate'),     
                        "Volume": vol,
                        "Status": self._determine_status(m),
                        "Tags": tags_list,             
                        "Token_Yes": tokens['yes'],
                        "Token_No": tokens['no']
                    })
        if not data: return pd.DataFrame()
        df = pd.DataFrame(data)
        cols_date = ['Start_Date', 'End_Date']
        for c in cols_date:
            if c in df.columns:
                df[c] = pd.to_datetime(df[c], errors='coerce', utc=True)
        
        if 'End_Date' in df.columns:
            df.sort_values(by=['End_Date', 'Volume'], ascending=[True, False], inplace=True)      
        return df

