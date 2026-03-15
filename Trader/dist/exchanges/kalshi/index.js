"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KalshiExchange = void 0;
const BaseExchange_1 = require("../../BaseExchange");
const auth_1 = require("./auth");
const api_1 = require("./api");
const stream_ws_1 = require("./stream_ws");
const types_1 = require("../../types");
class KalshiExchange extends BaseExchange_1.BaseExchange {
    // ... imports
    // ... dentro da classe KalshiExchange
    constructor(credentials) {
        super(credentials);
        this.auth = new auth_1.KalshiAuth(credentials);
        this.api = new api_1.KalshiRestApi(this.auth);
        this.stream = new stream_ws_1.KalshiStream(this.auth);
    }
    get name() { return "Kalshi"; }
    async initialize() {
        // 1. Testa REST
        await this.api.getBalance();
        console.log("✅ Kalshi REST OK.");
        // 2. Inicia Stream
        this.stream.connect((msg) => this.handleStreamMessage(msg));
    }
    async close() {
        this.stream.close();
    }
    // --- Implementação do Streaming ---
    subscribeToTicker(ticker) {
        this.stream.subscribe(ticker);
    }
    // ... (constructor, initialize, close...)
    // 2. Adicione este método novo (que estava faltando)
    onFill(callback) {
        this.onFillCallback = callback;
    }
    onOrderBookDelta(callback) {
        this.onOrderBookDeltaCallback = callback;
    }
    // 3. Atualize o handleStreamMessage para processar o FILL
    handleStreamMessage(data) {
        // Se for dados de Orderbook
        if (data.type === 'orderbook_snapshot' || data.type === 'orderbook_delta') {
            if (this.onOrderBookDeltaCallback) {
                this.onOrderBookDeltaCallback(data);
            }
        }
        // --- SE FOR DADOS DE EXECUÇÃO (FILL) ---
        if (data.type === 'fill') {
            // O payload real fica dentro de data.msg, conforme sua doc
            const fillData = data.msg;
            if (this.onFillCallback) {
                this.onFillCallback(fillData);
            }
        }
    }
    // ... resto do código igual
    // --- Implementação do Trading (Repassa para API) ---
    async fetchOrderBook(ticker) {
        const data = await this.api.getOrderBookSnapshot(ticker);
        const mapLvl = (l) => ({ price: l[0] / 100, size: l[1] });
        return {
            symbol: ticker,
            bids: data.bids ? data.bids.map(mapLvl) : [],
            asks: data.asks ? data.asks.map(mapLvl) : [],
            timestamp: Date.now()
        };
    }
    async fetchOpenOrders(ticker) {
        // 1. Chama a API
        const orders = await this.api.getOpenOrders(ticker);
        // 2. Converte (Map) o formato "estranho" da Kalshi para o formato padrão "Order"
        return orders.map((o) => ({
            id: o.order_id,
            marketId: o.ticker,
            side: o.action === 'buy' ? types_1.OrderSide.BUY : types_1.OrderSide.SELL,
            type: types_1.OrderType.LIMIT,
            price: o.yes_price / 100, // Converte 2 cents -> 0.02
            amount: o.count,
            filled: o.yes_filled_count || 0,
            remaining: o.count - (o.yes_filled_count || 0),
            status: types_1.OrderStatus.OPEN,
            timestamp: new Date(o.created_time).getTime(),
            raw: o // Guarda o original por segurança
        }));
    }
    async fetchBalance() {
        return this.api.getBalance();
    }
    async createOrder(params) {
        const res = await this.api.createOrder(params);
        return this.mapOrder(res.order);
    }
    async updateOrder(id, price, amount) {
        const res = await this.api.updateOrder(id, price, amount);
        return this.mapOrder(res.order);
    }
    async cancelOrder(id) {
        const res = await this.api.cancelOrder(id);
        return this.mapOrder(res.order);
    }
    async cancelAllOrders(ticker) {
        // Implementação futura: Buscar abertas via API e cancelar loop
        console.log("Cancel All não implementado na V1");
    }
    mapOrder(kOrder) {
        return {
            id: kOrder.order_id,
            marketId: kOrder.ticker,
            side: kOrder.action === 'buy' ? types_1.OrderSide.BUY : types_1.OrderSide.SELL,
            type: types_1.OrderType.LIMIT,
            price: kOrder.yes_price / 100,
            amount: kOrder.count,
            filled: kOrder.yes_filled_count || 0,
            remaining: kOrder.count - (kOrder.yes_filled_count || 0),
            status: kOrder.status === 'executed' ? types_1.OrderStatus.FILLED : types_1.OrderStatus.OPEN,
            timestamp: new Date(kOrder.created_time).getTime(),
            raw: kOrder
        };
    }
}
exports.KalshiExchange = KalshiExchange;
