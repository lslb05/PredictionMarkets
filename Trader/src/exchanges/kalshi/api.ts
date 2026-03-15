import axios, { AxiosInstance } from 'axios';
import { KalshiAuth } from './auth';
import { v4 as uuidv4 } from 'uuid';

export type OrderSide = 'yes' | 'no';
export type OrderAction = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';

export interface CreateOrderParams {
    ticker: string;
    action: OrderAction;
    side: OrderSide;
    count: number;
    price: number; 
    type?: OrderType;
}

export interface KalshiOrderResponse {
    order_id: string;
    client_order_id: string;
    status: string;
}

export interface BalanceResponse {
    balance: number;
}

export class KalshiApi {
    private client: AxiosInstance;
    private auth: KalshiAuth;
    private baseUrl: string;

    constructor(auth: KalshiAuth) {
        this.auth = auth;
        this.baseUrl = 'https://api.elections.kalshi.com/trade-api/v2';
        
        this.client = axios.create({
            baseURL: this.baseUrl,
            validateStatus: (status) => status < 500
        });
    }

    public async createOrder(params: CreateOrderParams): Promise<KalshiOrderResponse> {
        const path = '/portfolio/orders';
        const method = 'POST';
        const clientOrderId = uuidv4();

        // 1. Monta o Payload Base
        const payload: any = {
            action: params.action,
            client_order_id: clientOrderId,
            count: params.count,
            side: params.side,
            ticker: params.ticker,
            type: params.type || 'limit',
            expiration_ts: null
        };

        // 2. CORREÇÃO CRÍTICA: Define o campo de preço correto baseando-se no lado
        if (params.side === 'yes') {
            payload.yes_price = params.price; // Preço em Centavos
        } else {
            payload.no_price = params.price;  // Preço em Centavos
        }

        const headers = this.auth.getHeaders(method, `/trade-api/v2${path}`);

        try {
            const response = await this.client.post(path, payload, { headers });

            if (response.status !== 201) {
                console.error(`❌ [KalshiAPI] Erro payload: ${JSON.stringify(payload)}`);
                console.error(`❌ [KalshiAPI] Resposta: ${JSON.stringify(response.data)}`);
                throw new Error(response.data?.message || 'Falha ao criar ordem');
            }

            return response.data.order;

        } catch (error: any) {
            console.error(`❌ [KalshiAPI] Exception: ${error.message}`);
            throw error;
        }
    }

    public async cancelOrder(orderId: string): Promise<boolean> {
        const path = `/portfolio/orders/${orderId}`;
        const method = 'DELETE';
        const headers = this.auth.getHeaders(method, `/trade-api/v2${path}`);

        try {
            const response = await this.client.delete(path, { headers });

            if (response.status === 200 || response.status === 204) {
                console.log(`✅ [KalshiAPI] Ordem ${orderId} cancelada.`);
                return true;
            } else if (response.status === 404) {
                console.warn(`⚠️ [KalshiAPI] Ordem ${orderId} não encontrada.`);
                return false;
            }
            throw new Error(`Erro cancelamento: ${response.status}`);
        } catch (error: any) {
            console.error(`❌ [KalshiAPI] Erro Cancel: ${error.message}`);
            return false;
        }
    }

    public async getBalance(): Promise<number> {
        const path = '/portfolio/balance';
        const method = 'GET';
        const headers = this.auth.getHeaders(method, `/trade-api/v2${path}`);

        try {
            const response = await this.client.get<BalanceResponse>(path, { headers });
            return response.data.balance / 100;
        } catch (error) {
            console.error("❌ [KalshiAPI] Erro ao ler saldo.");
            return 0;
        }
    }
}