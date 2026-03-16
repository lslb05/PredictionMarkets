import { 
    ExchangeCredentials, 
    OrderBook, 
    Order, 
    CreateOrderParams, 
    PriceUpdateCallback, 
    OrderFillCallback 
} from './types';

export abstract class BaseExchange {
    protected credentials?: ExchangeCredentials;
    
    protected onPriceUpdateCallback?: PriceUpdateCallback;
    protected onOrderFillCallback?: OrderFillCallback;

    constructor(credentials?: ExchangeCredentials) {
        this.credentials = credentials;
    }

    abstract get name(): string;
    abstract initialize(): Promise<void>;

    abstract close(): Promise<void>;

    abstract fetchOrderBook(ticker: string): Promise<OrderBook>;

    abstract fetchBalance(): Promise<number>;
    abstract subscribeToTicker(ticker: string): void;

    public onPriceUpdate(callback: PriceUpdateCallback) {
        this.onPriceUpdateCallback = callback;
    }

    public onOrderFill(callback: OrderFillCallback) {
        this.onOrderFillCallback = callback;
    }
    abstract createOrder(params: CreateOrderParams): Promise<Order>;

    abstract cancelOrder(orderId: string): Promise<Order>;

    abstract updateOrder(orderId: string, newPrice: number, newAmount?: number): Promise<Order>;
    
    abstract cancelAllOrders(ticker?: string): Promise<void>;
}