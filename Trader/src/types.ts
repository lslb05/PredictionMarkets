// ----------------------------------------------------------------------------
// Enums (Padronização)
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// Configuração (Input do Sistema)
// ----------------------------------------------------------------------------

export interface ExchangeCredentials {
    apiKey?: string;
    apiSecret?: string;
    // --- CAMPOS ESPECÍFICOS DO POLYMARKET ---
    passphrase?: string;    // Necessário
    privateKey: string;     // Obrigatório
    funderAddress?: string; // Para contas Proxy (Email)
    signatureType?: number; 
}

// O Objeto que define a estratégia (passado manualmente ou pelo Python)
export interface ArbPairConfig {
    // Kalshi (Lado Maker)
    kalshiTicker: string;      // ex: "PRES-24-TRUMP"
    kalshiTickSize: number;    // ex: 0.01 (Incremento mínimo de preço)

    // Polymarket (Lado Taker)
    polyMarketId: string;      // ex: "0x289..." (Token ID / Asset ID)
    polyTickSize: number;      // ex: 0.001 (Pode ser mais preciso que o Kalshi)

    // Regras de Execução
    spreadAlvo: number;        // ex: 0.03 (Lucro bruto desejado por contrato)
    qty: number;               // ex: 10 (Quantidade de contratos a operar)
    maxPosition: number;       // ex: 100 (Trava de segurança)
}

export interface OrderLevel {
    price: number; 
    size: number;  
}

export interface OrderBook {
    symbol: string;
    bids: OrderLevel[]; // Compradores
    asks: OrderLevel[]; // Vendedores
    timestamp: number;
}

// ----------------------------------------------------------------------------
// Estruturas de Execução (Ordens)
// ----------------------------------------------------------------------------

export interface CreateOrderParams {
    marketId: string;    // Ticker ou TokenID
    side: OrderSide;
    type: OrderType;
    amount: number;      // Quantidade de contratos
    price?: number;      // Obrigatório para LIMIT
    postOnly?: boolean;  // Maker flag: Garante que não vai executar a mercado (e pagar taxa)
}

export interface Order {
    id: string;          // ID da Exchange
    marketId: string;
    side: OrderSide;
    type: OrderType;
    price?: number;
    amount: number;
    status: OrderStatus;
    filled: number;      // Quantidade já executada
    remaining: number;   // Quantidade sobrando
    timestamp: number;
    raw?: any;           // Guarda o objeto original da exchange para debug
}

// ----------------------------------------------------------------------------
// Callbacks (Para WebSocket)
// ----------------------------------------------------------------------------
// Chamado quando o preço muda no Orderbook
// bestBid/bestAsk são essenciais para calcular o spread
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