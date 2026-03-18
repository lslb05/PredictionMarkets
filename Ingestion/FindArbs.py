import os
import json
import requests
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from Kalshi.utils import KalshiAuth 

load_dotenv()

class CrossSumArbitrage:
    def __init__(self):
        raw_db_url = os.getenv("DATABASE_URL")
        db_url = raw_db_url.replace("+asyncpg", "+psycopg2") if "+asyncpg" in raw_db_url else raw_db_url
        self.engine = create_engine(db_url)
        self.kalshi_auth = KalshiAuth(os.getenv("KALSHI_PROD_KEYID"), os.getenv("KALSHI_API_KEY"))
        self.kalshi_base = "https://api.elections.kalshi.com/trade-api/v2"
        self.poly_clob_url = "https://clob.polymarket.com/book"

    def get_poly_ask(self, token_id):
        try:
            resp = requests.get(self.poly_clob_url, params={"token_id": token_id}, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                return float(data['asks'][-1]['price']) if data.get('asks') else None
        except: return None

    def get_kalshi_bids(self, ticker):
        path = f"/markets/{ticker}"
        headers = self.kalshi_auth.get_headers("GET", path)
        try:
            resp = requests.get(f"{self.kalshi_base}{path}", headers=headers, timeout=5)
            if resp.status_code == 200:
                m = resp.json().get('market', {})
                y_bid = m.get('yes_bid') / 100 if m.get('yes_bid') else 0
                n_bid = m.get('no_bid') / 100 if m.get('no_bid') else 0
                return y_bid, n_bid
        except: return None, None

    def run(self):
        query = text("""
            SELECT 
                m_k.external_id as ticker_k, 
                m_p.execution_data as poly_exec, 
                m_k.title,
                m_k.specific_outcome
            FROM core.matched_markets mt
            JOIN core.markets m_k ON mt.kalshi_id = m_k.id
            JOIN core.markets m_p ON mt.poly_id = m_p.id
        """)
        
        with self.engine.connect() as conn:
            df = pd.read_sql(query, conn)

        all_opportunities = []
        for _, row in df.iterrows():
            poly_data = row['poly_exec']
            if isinstance(poly_data, str): poly_data = json.loads(poly_data)
            k_yes_bid, k_no_bid = self.get_kalshi_bids(row['ticker_k'])
            p_yes_ask = self.get_poly_ask(poly_data.get('token_yes'))
            p_no_ask = self.get_poly_ask(poly_data.get('token_no'))

            market_display_name = f"{row['title']} | {row['specific_outcome']}"
            op1 = None
            op2 = None
            if k_yes_bid is not None and p_no_ask is not None:
                sum1 = k_yes_bid + p_no_ask
                if sum1 <= 0.98:
                    op1 = {
                        'market': market_display_name,
                        'type': 'K-Yes(Bid) + P-No(Ask)',
                        'sum': sum1,
                        'implied_spread': (1.0 - sum1) * 100,
                        'details': f"K-Bid: ${k_yes_bid:.2f} | P-Ask: ${p_no_ask:.2f}"
                    }
            if k_no_bid is not None and p_yes_ask is not None:
                sum2 = k_no_bid + p_yes_ask
                if sum2 <= 0.98:
                    op2 = {
                        'market': market_display_name,
                        'type': 'K-No(Bid) + P-Yes(Ask)',
                        'sum': sum2,
                        'implied_spread': (1.0 - sum2) * 100,
                        'details': f"K-Bid: ${k_no_bid:.2f} | P-Ask: ${p_yes_ask:.2f}"
                    }
            chosen_op = None

            if op1 and op2:
                if op1['implied_spread'] >= op2['implied_spread']:
                    chosen_op = op1
                else:
                    chosen_op = op2
            elif op1:
                chosen_op = op1
            elif op2:
                chosen_op = op2
            
            if chosen_op:
                all_opportunities.append(chosen_op)

        if not all_opportunities:
            print("No opportunities found at the moment.")
        else:
            sorted_arbs = sorted(all_opportunities, key=lambda x: x['implied_spread'], reverse=True)
            print("\n" + "="*80)
            print(f"{len(sorted_arbs)} Best opportunities found")
            print("="*80)
            
            for arb in sorted_arbs:
                symbol = "🟢" if "Yes(Bid)" in arb['type'] else "🔵"              
                print(f"{symbol} Spread: {arb['implied_spread']:.1f}¢ | Soma: ${arb['sum']:.2f}")
                print(f"   Market:    {arb['market']}")
                print(f"   Strategy: {arb['type']}")
                print(f"   {arb['details']}")
                print("-" * 80)
