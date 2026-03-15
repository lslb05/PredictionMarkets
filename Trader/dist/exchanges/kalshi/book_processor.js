"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KalshiBookProcessor = void 0;
class KalshiBookProcessor {
    constructor(stream, ticker) {
        this.yesBids = new Map(); // Bids diretos do YES
        this.noBids = new Map(); // Bids do NO (usados para criar Asks do YES)
        this.stream = stream;
        this.ticker = ticker;
    }
    start(onUpdate) {
        this.onUpdateCallback = onUpdate;
        console.log(`🧠 [KalshiProcessor] Iniciando: ${this.ticker}`);
        this.stream.connect((msg) => {
            if (msg.type === 'orderbook_snapshot')
                this.handleSnapshot(msg.msg);
            else if (msg.type === 'orderbook_delta')
                this.handleDelta(msg.msg);
        });
        // ✅ CORREÇÃO: Esperar um pouco para garantir que conectou antes de subscribir
        // Mas melhor ainda é chamar dentro do connect() callback
        // Por isso, vamos chamar aqui após um delay curto
        setTimeout(() => {
            console.log(`📡 [KalshiProcessor] Enviando subscribe para ${this.ticker}`);
            this.stream.subscribe(this.ticker);
        }, 500);
    }
    handleSnapshot(data) {
        if (data.market_ticker !== this.ticker)
            return;
        this.yesBids.clear();
        this.noBids.clear();
        if (data.yes)
            data.yes.forEach((x) => this.yesBids.set(x[0], x[1]));
        if (data.no)
            data.no.forEach((x) => this.noBids.set(x[0], x[1]));
        this.emitState();
    }
    handleDelta(data) {
        if (data.market_ticker !== this.ticker)
            return;
        const updateMap = (map, items) => {
            items.forEach(([price, delta]) => {
                const newQty = (map.get(price) || 0) + delta;
                if (newQty <= 0)
                    map.delete(price);
                else
                    map.set(price, newQty);
            });
        };
        if (data.yes)
            updateMap(this.yesBids, data.yes);
        if (data.no)
            updateMap(this.noBids, data.no);
        this.emitState();
    }
    emitState() {
        if (!this.onUpdateCallback)
            return;
        // 1. Kalshi YES Bids (Alguém quer comprar YES)
        // Pegamos os Top 3 Bids diretos
        const sortedYesBids = Array.from(this.yesBids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p / 100, size: s }));
        // 2. Kalshi YES Asks (Alguém quer vender YES)
        // Derivado de: Alguém quer comprar NO (Bid NO)
        // Preço = 100 - BidNO
        const sortedNoBids = Array.from(this.noBids.entries())
            .sort((a, b) => b[0] - a[0]) // Ordena NO Bids do maior pro menor (40, 39...)
            .slice(0, 3)
            .map(([p, s]) => ({
            price: (100 - p) / 100, // Ex: 100 - 40 = 60 cents
            size: s
        }))
            .sort((a, b) => a.price - b.price); // Reordena o resultado (Asks: menor pro maior)
        const bestBid = sortedYesBids.length > 0 ? sortedYesBids[0].price : 0;
        const bestAsk = sortedNoBids.length > 0 ? sortedNoBids[0].price : 0;
        const state = {
            bids: sortedYesBids,
            asks: sortedNoBids,
            spread: (bestAsk > 0 && bestBid > 0) ? bestAsk - bestBid : 0,
            timestamp: Date.now()
        };
        this.onUpdateCallback(state);
    }
}
exports.KalshiBookProcessor = KalshiBookProcessor;
