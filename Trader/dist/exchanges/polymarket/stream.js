"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketStream = void 0;
const ws_1 = __importDefault(require("ws"));
const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
class PolymarketStream {
    constructor(assetId, isYesToken = true) {
        this.ws = null;
        this.bids = new Map();
        this.asks = new Map();
        this.onUpdate = null;
        this.assetId = assetId;
        this.isYesToken = isYesToken;
    }
    connect(callback) {
        this.onUpdate = callback || null;
        console.log(`🔌 [PolyStream] Conectando: ${this.assetId.slice(0, 10)}...`);
        this.ws = new ws_1.default(WS_URL);
        this.ws.on('open', () => {
            console.log("✅ [PolyStream] Conectado.");
            const msg = { assets_ids: [this.assetId], type: "market" };
            this.ws?.send(JSON.stringify(msg));
        });
        this.ws.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                const events = Array.isArray(parsed) ? parsed : [parsed];
                let changed = false;
                for (const event of events) {
                    if (this.processEvent(event))
                        changed = true;
                }
                if (changed && this.onUpdate)
                    this.onUpdate(this.getNormalizedState());
            }
            catch (err) { }
        });
    }
    // NOVA LÓGICA DE NORMALIZAÇÃO COM DEPTH
    getNormalizedState() {
        // Ordenação Crua
        const rawBids = Array.from(this.bids.entries()).sort((a, b) => b[0] - a[0]);
        const rawAsks = Array.from(this.asks.entries()).sort((a, b) => a[0] - b[0]);
        let finalBids = [];
        let finalAsks = [];
        if (this.isYesToken) {
            // Se é YES, usa direto
            finalBids = rawBids.slice(0, 3).map(([p, s]) => ({ price: p, size: s }));
            finalAsks = rawAsks.slice(0, 3).map(([p, s]) => ({ price: p, size: s }));
        }
        else {
            // Se é NO, inverte a lógica
            // YES Bid = 1 - NO Ask
            finalBids = rawAsks.slice(0, 3).map(([p, s]) => ({
                price: 1 - p,
                size: s
            })).sort((a, b) => b.price - a.price); // Reordena desc
            // YES Ask = 1 - NO Bid
            finalAsks = rawBids.slice(0, 3).map(([p, s]) => ({
                price: 1 - p,
                size: s
            })).sort((a, b) => a.price - b.price); // Reordena asc
        }
        const bestBid = finalBids.length > 0 ? finalBids[0].price : 0;
        const bestAsk = finalAsks.length > 0 ? finalAsks[0].price : 0;
        return {
            bids: finalBids,
            asks: finalAsks,
            spread: (bestAsk > 0 && bestBid > 0) ? bestAsk - bestBid : 0,
            timestamp: Date.now()
        };
    }
    processEvent(event) {
        if (event.event_type === "book") {
            if (event.asset_id !== this.assetId)
                return false;
            this.bids.clear();
            this.asks.clear();
            event.bids.forEach((x) => this.bids.set(parseFloat(x.price), parseFloat(x.size)));
            event.asks.forEach((x) => this.asks.set(parseFloat(x.price), parseFloat(x.size)));
            return true;
        }
        if (event.event_type === "price_change") {
            let updated = false;
            const changes = event.price_changes || [];
            for (const change of changes) {
                if (change.asset_id !== this.assetId)
                    continue;
                updated = true;
                const price = parseFloat(change.price);
                const size = parseFloat(change.size);
                const target = (change.side === "BUY") ? this.bids : this.asks;
                if (size === 0)
                    target.delete(price);
                else
                    target.set(price, size);
            }
            return updated;
        }
        return false;
    }
}
exports.PolymarketStream = PolymarketStream;
