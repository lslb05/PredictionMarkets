"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseExchange = void 0;
class BaseExchange {
    constructor(credentials) {
        this.credentials = credentials;
    }
    /**
     * Define a função que o bot vai rodar quando o preço mudar.
     */
    onPriceUpdate(callback) {
        this.onPriceUpdateCallback = callback;
    }
    /**
     * Define a função que o bot vai rodar quando uma ordem for executada.
     */
    onOrderFill(callback) {
        this.onOrderFillCallback = callback;
    }
}
exports.BaseExchange = BaseExchange;
