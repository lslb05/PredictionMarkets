"use strict";
// ----------------------------------------------------------------------------
// Enums (Padronização)
// ----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandleInterval = exports.OrderStatus = exports.OrderType = exports.OrderSide = void 0;
var OrderSide;
(function (OrderSide) {
    OrderSide["BUY"] = "buy";
    OrderSide["SELL"] = "sell";
})(OrderSide || (exports.OrderSide = OrderSide = {}));
var OrderType;
(function (OrderType) {
    OrderType["LIMIT"] = "limit";
    OrderType["MARKET"] = "market";
})(OrderType || (exports.OrderType = OrderType = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDING"] = "pending";
    OrderStatus["OPEN"] = "open";
    OrderStatus["FILLED"] = "filled";
    OrderStatus["CANCELLED"] = "cancelled";
    OrderStatus["PARTIALLY_FILLED"] = "PARTIALLY_FILLED";
    OrderStatus["REJECTED"] = "rejected";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var CandleInterval;
(function (CandleInterval) {
    CandleInterval["ONE_MINUTE"] = "1m";
    CandleInterval["FIVE_MINUTES"] = "5m";
    CandleInterval["FIFTEEN_MINUTES"] = "15m";
    CandleInterval["ONE_HOUR"] = "1h";
    CandleInterval["ONE_DAY"] = "1d";
})(CandleInterval || (exports.CandleInterval = CandleInterval = {}));
