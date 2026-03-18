import { KalshiStream } from '../exchanges/kalshi/stream_ws';

export interface FillEvent {
    orderId: string;
    tradeId: string;
    ticker: string;
    isTaker: boolean;
    side: 'yes' | 'no';
    count: number;
    price: number;
    timestamp: number;
}

export class KalshiFillMonitor {
    private stream: KalshiStream;
    private targetTicker: string;
    private onFillCallback: ((fill: FillEvent) => void) | null = null;

    constructor(stream: KalshiStream, targetTicker: string) {
        this.stream = stream;
        this.targetTicker = targetTicker;
    }

    public setCallback(callback: (fill: FillEvent) => void) {
        this.onFillCallback = callback;
    }

    public subscribe() {
        const subscribeMsg = {
            id: Math.floor(Math.random() * 100000),
            cmd: 'subscribe',
            params: { channels: ['fill'] }
        };
        console.log("🔔 [FillMonitor] Enviando inscrição 'fill'...");
        this.stream.send(subscribeMsg);
    }

    public processMessage(msg: any) {
        if (msg.type === 'fill' && msg.msg) {
            const data = msg.msg;

            if (data.market_ticker !== this.targetTicker) return;

            let priceCents = 0;
            if (data.yes_price) priceCents = data.yes_price;
            else if (data.no_price) priceCents = data.no_price;
            else if (data.yes_price_dollars) priceCents = Math.round(parseFloat(data.yes_price_dollars) * 100);

            const event: FillEvent = {
                orderId: data.order_id,
                tradeId: data.trade_id,
                ticker: data.market_ticker,
                isTaker: data.is_taker,
                side: data.side,
                count: data.count,
                price: priceCents,
                timestamp: data.ts || Date.now()
            };

            if (this.onFillCallback) this.onFillCallback(event);
        }
    }
}