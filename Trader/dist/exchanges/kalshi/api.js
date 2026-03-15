"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KalshiRestApi = void 0;
const axios_1 = __importDefault(require("axios"));
const types_1 = require("../../types");
// Separamos o HOST do PATH para montar a assinatura corretamente
const API_HOST = 'https://api.elections.kalshi.com';
const BASE_PATH = '/trade-api/v2';
class KalshiRestApi {
    constructor(auth) {
        this.auth = auth;
    }
    async request(method, endpoint, data) {
        // O PULO DO GATO:
        // O endpoint é "/portfolio/balance", mas para assinar precisamos de "/trade-api/v2/portfolio/balance"
        const fullPath = `${BASE_PATH}${endpoint}`;
        // Gera headers assinando o CAMINHO COMPLETO
        const headers = this.auth.getHeaders(method, fullPath);
        try {
            const response = await (0, axios_1.default)({
                method,
                // O Axios precisa da URL completa (Host + Path)
                url: `${API_HOST}${fullPath}`,
                headers,
                data
            });
            return response.data;
        }
        catch (error) {
            if (error.response) {
                // Loga o erro detalhado para facilitar debug
                throw new Error(`Kalshi REST Error [${error.response.status}]: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
    async getBalance() {
        // endpoint relativo
        const res = await this.request('GET', '/portfolio/balance');
        return res.balance / 100;
    }
    async getOrderBookSnapshot(ticker) {
        const res = await this.request('GET', `/markets/${ticker}/orderbook`);
        return res.orderbook;
    }
    async createOrder(params) {
        if (!params.price)
            throw new Error("Preço obrigatório no Kalshi");
        const body = {
            action: params.side === types_1.OrderSide.BUY ? 'buy' : 'sell',
            count: params.amount,
            type: 'limit',
            ticker: params.marketId,
            yes_price: Math.round(params.price * 100),
            side: 'yes'
        };
        return await this.request('POST', '/portfolio/orders', body);
    }
    // ... dentro da classe KalshiRestApi ...
    async getOpenOrders(ticker) {
        const endpoint = '/portfolio/orders';
        // MUDANÇA: Usamos uma query string simples e fixa para evitar erro de assinatura
        // Buscamos TODAS as ordens abertas da conta
        const fullUrl = `${endpoint}?status=open`;
        try {
            const res = await this.request('GET', fullUrl);
            let orders = res.orders || [];
            // FILTRO CLIENT-SIDE:
            // Se o usuário pediu um ticker específico, filtramos aqui na memória
            if (ticker) {
                orders = orders.filter((o) => o.ticker === ticker);
            }
            return orders;
        }
        catch (error) {
            // Se não tiver ordens ou der erro 404, retorna array vazio para não quebrar o bot
            return [];
        }
    }
    async updateOrder(orderId, newPrice, newAmount) {
        const body = {
            yes_price: Math.round(newPrice * 100)
        };
        if (newAmount)
            body.count = newAmount;
        return await this.request('PUT', `/portfolio/orders/${orderId}`, body);
    }
    async cancelOrder(orderId) {
        return await this.request('DELETE', `/portfolio/orders/${orderId}`);
    }
}
exports.KalshiRestApi = KalshiRestApi;
