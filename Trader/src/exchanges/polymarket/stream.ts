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
    
    // Armazena os livros de ofertas separadamente por Asset ID
    private books = new Map<string, {
        bids: Map<number, number>,
        asks: Map<number, number>
    }>();

    private assetIds: string[];
    private mainTokenId: string;
    private onUpdate: ((state: MarketState) => void) | null = null;

    constructor(assetIds: string | string[], mainTokenId?: string) {
        this.assetIds = Array.isArray(assetIds) ? assetIds : [assetIds];
        this.mainTokenId = mainTokenId || this.assetIds[0];

        this.assetIds.forEach(id => {
            this.books.set(id, { bids: new Map(), asks: new Map() });
        });
    }

    public connect(callback?: (state: MarketState) => void) {
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
                
                let shouldEmit = false;
                for (const ev of eventList) {
                    if (this.processEvent(ev)) shouldEmit = true;
                }

                if (shouldEmit && this.onUpdate) {
                    this.onUpdate(this.getUnifiedState());
                }
            } catch (e) { return; }
        });
    }

    private processEvent(event: any): boolean {
        if (event.event_type === "book") {
            if (!event.asset_id || !this.books.has(event.asset_id)) return false;

            const book = this.books.get(event.asset_id)!;
            book.bids.clear();
            book.asks.clear();
            
            event.bids.forEach((x: any) => book.bids.set(parseFloat(x.price), parseFloat(x.size)));
            event.asks.forEach((x: any) => book.asks.set(parseFloat(x.price), parseFloat(x.size)));
            
            return true;
        }

        if (event.event_type === "price_change") {
            const changes = event.price_changes || [];
            let updated = false;

            for (const change of changes) {

                if (!change.asset_id || !this.books.has(change.asset_id)) continue;

                const book = this.books.get(change.asset_id)!;
                const price = parseFloat(change.price);
                const size = parseFloat(change.size);
                const sideMap = (change.side === "BUY") ? book.bids : book.asks;
                
                if (size === 0) sideMap.delete(price);
                else sideMap.set(price, size);
                
                updated = true;
            }
            return updated;
        }

        return false;
    }

    public getUnifiedState(): MarketState {
        const mainBook = this.books.get(this.mainTokenId);
        if (!mainBook) return { bids: [], asks: [], spread: 0, timestamp: 0 };

        const sortedBids = Array.from(mainBook.bids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p, size: s }));

        const sortedAsks = Array.from(mainBook.asks.entries())
            .sort((a, b) => a[0] - b[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p, size: s }));

        return {
            bids: sortedBids,
            asks: sortedAsks,
            spread: (sortedAsks[0]?.price || 0) - (sortedBids[0]?.price || 0),
            timestamp: Date.now()
        };
    }
}