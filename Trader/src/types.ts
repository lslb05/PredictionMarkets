export enum OrderSide {
    BUY = 'buy',
    SELL = 'sell'
}

export enum OrderType {
    LIMIT = 'limit',
    MARKET = 'market'
}

export enum OrderStatus {
    PENDING = 'pending',
    OPEN = 'open',
    FILLED = 'filled',
    CANCELLED = 'cancelled',
    PARTIALLY_FILLED = 'PARTIALLY_FILLED',
    REJECTED = 'rejected'
}

export interface ExchangeCredentials {
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;
    privateKey: string;
    funderAddress?: string;
    signatureType?: number;
}

export interface ArbPairConfig {
    kalshiTicker: string;
    kalshiTickSize: number;

    polyMarketId: string;
    polyTickSize: number;

    spreadAlvo: number;
    qty: number;
    maxPosition: number;
}

export interface OrderLevel {
    price: number;
    size: number;
}

export interface OrderBook {
    symbol: string;
    bids: OrderLevel[];
    asks: OrderLevel[];
    timestamp: number;
}

// ==========================================================================================
// Estruturas de Execução (Ordens)
// ==========================================================================================

export interface CreateOrderParams {
    marketId: string;
    side: OrderSide;
    type: OrderType;
    amount: number;
    price?: number;
    postOnly?: boolean;
}

export interface Order {
    id: string;
    marketId: string;
    side: OrderSide;
    type: OrderType;
    price?: number;
    amount: number;
    status: OrderStatus;
    filled: number;
    remaining: number;
    timestamp: number;
    raw?: any;
}

// ==========================================================================================
// Callbacks (Para WebSocket)
// ==========================================================================================
export type PriceUpdateCallback = (marketId: string, bestBid: number, bestAsk: number) => void;

export type OrderFillCallback = (order: Order) => void;

export interface MarketState {
    bids: OrderLevel[];
    asks: OrderLevel[];
    spread: number;
    timestamp: number;
}

export interface MarketOutcome {
    id: string;
    label?: string;
    name?: string;
    price: number;
    priceChange24h?: number;
    metadata?: Record<string, any>;
}

export interface UnifiedMarket {
    id: string;
    title: string;
    description?: string;
    outcomes?: MarketOutcome[];
    resolutionDate?: Date;
    volume24h?: number;
    volume?: number;
    liquidity?: number;
    openInterest?: number;
    url?: string;
    image?: string;
    category?: string;
    tags?: string[];
}

export enum CandleInterval {
    ONE_MINUTE = '1m',
    FIVE_MINUTES = '5m',
    FIFTEEN_MINUTES = '15m',
    ONE_HOUR = '1h',
    SIX_HOURS = '6h',
    ONE_DAY = '1d'
}