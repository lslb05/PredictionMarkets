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
    
    // Armazena as funções que o Index.ts vai passar
    protected onPriceUpdateCallback?: PriceUpdateCallback;
    protected onOrderFillCallback?: OrderFillCallback;

    constructor(credentials?: ExchangeCredentials) {
        this.credentials = credentials;
    }

    // Nome para logs (ex: "Kalshi", "Poly")
    abstract get name(): string;

    // ------------------------------------------------------------------------
    // 1. Inicialização e Conexão
    // ------------------------------------------------------------------------
    
    /**
     * Autentica na API REST e conecta nos WebSockets necessários.
     * Deve ser chamado antes de qualquer operação.
     */
    abstract initialize(): Promise<void>;

    /**
     * Fecha sockets e limpa intervalos. Útil para "Graceful Shutdown".
     */
    abstract close(): Promise<void>;

    // ------------------------------------------------------------------------
    // 2. Dados de Mercado (Leitura)
    // ------------------------------------------------------------------------

    /**
     * Retorna o Orderbook ATUAL (Snapshot).
     * Útil para pegar o preço inicial antes do WebSocket começar a streamar.
     */
    abstract fetchOrderBook(ticker: string): Promise<OrderBook>;

    /**
     * Retorna o saldo disponível em USD (Kalshi) ou USDC (Poly).
     * Usado para verificar se temos caixa antes de operar.
     */
    abstract fetchBalance(): Promise<number>;

    // ------------------------------------------------------------------------
    // 3. Streaming (WebSocket)
    // ------------------------------------------------------------------------

    /**
     * Assina o canal de Orderbook/Preço para um ticker específico.
     * Deve disparar o `onPriceUpdateCallback` quando houver mudança.
     */
    abstract subscribeToTicker(ticker: string): void;

    /**
     * Define a função que o bot vai rodar quando o preço mudar.
     */
    public onPriceUpdate(callback: PriceUpdateCallback) {
        this.onPriceUpdateCallback = callback;
    }

    /**
     * Define a função que o bot vai rodar quando uma ordem for executada.
     */
    public onOrderFill(callback: OrderFillCallback) {
        this.onOrderFillCallback = callback;
    }

    // ------------------------------------------------------------------------
    // 4. Execução (Escrita)
    // ------------------------------------------------------------------------

    /**
     * Envia uma ordem nova.
     */
    abstract createOrder(params: CreateOrderParams): Promise<Order>;

    /**
     * Cancela uma ordem existente.
     */
    abstract cancelOrder(orderId: string): Promise<Order>;

    /**
     * ATUALIZAÇÃO ATÔMICA (Crucial para Maker).
     * No Kalshi: Usa o endpoint PUT /orders/{id}.
     * No Polymarket: Como não tem update nativo, implementa "CancelAll + CreateNew".
     */
    abstract updateOrder(orderId: string, newPrice: number, newAmount?: number): Promise<Order>;
    
    /**
     * Zera posição a mercado (Função de emergência/Panic Button).
     */
    abstract cancelAllOrders(ticker?: string): Promise<void>;
}