import { KalshiStream } from './stream_ws';
import { MarketState } from '../polymarket/stream';

export class KalshiBookProcessor {
    private stream: KalshiStream;
    private ticker: string;
    
    private yesBids = new Map<number, number>();
    private noBids = new Map<number, number>();
    
    private onUpdateCallback?: (state: MarketState) => void;

    constructor(stream: KalshiStream, ticker: string) {
        this.stream = stream;
        this.ticker = ticker;
    }

    public setCallback(onUpdate: (state: MarketState) => void) {
        this.onUpdateCallback = onUpdate;
    }
    public processMessage(msg: any) {
        if (!msg || !msg.msg) return;
        if (msg.msg.market_ticker !== this.ticker) return;
        if (msg.type === 'orderbook_delta') {
            this.handleDelta(msg.msg);
        } else if (msg.type === 'orderbook_snapshot') {
            this.handleSnapshot(msg.msg);
        }
    }

    private handleSnapshot(data: any) {
        this.yesBids.clear();
        this.noBids.clear();       
        const yes = data.yes || [];
        for (let i = 0; i < yes.length; i++) this.yesBids.set(yes[i][0], yes[i][1]);
        const no = data.no || [];
        for (let i = 0; i < no.length; i++) this.noBids.set(no[i][0], no[i][1]);
        this.emitState();
    }

    private handleDelta(data: any) {
        const targetMap = (data.side === 'yes') ? this.yesBids : this.noBids;
        const currentQty = targetMap.get(data.price) || 0;
        const newQty = currentQty + data.delta;
        
        if (newQty <= 0) targetMap.delete(data.price);
        else targetMap.set(data.price, newQty);
        
        this.emitState();
    }

    private emitState() {
        if (!this.onUpdateCallback) return;


        const sortedYesBids = Array.from(this.yesBids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, 3)
            .map(([p, s]) => ({ price: p / 100, size: s }));


        const sortedNoBids = Array.from(this.noBids.entries())
            .sort((a, b) => b[0] - a[0]) 
            .slice(0, 3)
            .map(([p, s]) => ({ price: p / 100, size: s }));

        this.onUpdateCallback({
            bids: sortedYesBids, 
            asks: sortedNoBids,  
            spread: 0, 
            timestamp: Date.now()
        });
    }
}