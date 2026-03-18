import WebSocket from 'ws';

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface OrderLevel {
    price: number;
    size: number;
}

export interface MarketState {
    bids: OrderLevel[]; 
    asks: OrderLevel[];
    spread: number;
    timestamp: number;
}

export class PolymarketStream {
    private ws: WebSocket | null = null;
    
      private books = new Map<string, {
        bids: Map<number, number>,
        asks: Map<number, number>
    }>();

    private assetIds: string[];
  
    private onUpdate: ((tokenId: string, state: MarketState) => void) | null = null;

    constructor(assetIds: string | string[]) {
        this.assetIds = Array.isArray(assetIds) ? assetIds : [assetIds];
        
        this.assetIds.forEach(id => {
            this.books.set(id, { bids: new Map(), asks: new Map() });
        });
    }

    public connect(callback?: (tokenId: string, state: MarketState) => void) {
        this.onUpdate = callback || null;
        console.log(`🔌 [PolyStream] Conectando ${this.assetIds.length} ativos...`);
        
        this.ws = new WebSocket(WS_URL, { perMessageDeflate: false });

        this.ws.on('open', () => {
            console.log("✅ [PolyStream] Conectado.");
            const msg = { assets_ids: this.assetIds, type: "market" };
            this.ws?.send(JSON.stringify(msg));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            const strData = data.toString();
            try {
                const events = JSON.parse(strData);
                const eventList = Array.isArray(events) ? events : [events];
                
                for (const ev of eventList) {
                    this.processEvent(ev);
                }
            } catch (e) { return; }
        });
    }

    private processEvent(event: any) {
        let targetId: string | null = null;

          if (event.event_type === "book") {
            if (!event.asset_id || !this.books.has(event.asset_id)) return;
            targetId = event.asset_id;

            const book = this.books.get(targetId!)!;
            book.bids.clear();
            book.asks.clear();
            
            event.bids.forEach((x: any) => book.bids.set(parseFloat(x.price), parseFloat(x.size)));
            event.asks.forEach((x: any) => book.asks.set(parseFloat(x.price), parseFloat(x.size)));
        }

    
        else if (event.event_type === "price_change") {
            const changes = event.price_changes || [];
            
    
            const touchedIds = new Set<string>();

            for (const change of changes) {
                if (!change.asset_id || !this.books.has(change.asset_id)) continue;
                
                const book = this.books.get(change.asset_id)!;
                const price = parseFloat(change.price);
                const size = parseFloat(change.size);
                const sideMap = (change.side === "BUY") ? book.bids : book.asks;
                
                if (size === 0) sideMap.delete(price);
                else sideMap.set(price, size);
                
                touchedIds.add(change.asset_id);
            }

    
            touchedIds.forEach(id => this.emitState(id));
            return;
        }

        if (targetId) this.emitState(targetId);
    }

    private emitState(tokenId: string) {
        if (!this.onUpdate) return;

        const book = this.books.get(tokenId);
        if (!book) return;

        const sortedBids = Array.from(book.bids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p, size: s }));

        const sortedAsks = Array.from(book.asks.entries())
            .sort((a, b) => a[0] - b[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p, size: s }));

        const state: MarketState = {
            bids: sortedBids,
            asks: sortedAsks,
            spread: (sortedAsks[0]?.price || 0) - (sortedBids[0]?.price || 0),
            timestamp: Date.now()
        };

        this.onUpdate(tokenId, state);
    }
}