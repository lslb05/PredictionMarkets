import WebSocket from 'ws';
import { KalshiAuth } from './auth';

const WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
const WS_PATH = '/trade-api/ws/v2';

type MsgCallback = (data: any) => void;

export class KalshiStream {
    private ws?: WebSocket;
    private onMessageCallback?: MsgCallback;
    private activeSubscriptions: Set<string> = new Set();
    private auth: KalshiAuth;
    private isConnected: boolean = false;
    private isClosing: boolean = false;
    
    // Controle de Reconexão
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECTS = 10;
    private readonly BASE_DELAY_MS = 1000;

    constructor(auth: KalshiAuth) {
        this.auth = auth;
    }

    connect(onMessage: MsgCallback): void {
        if (this.isClosing) return;
        this.onMessageCallback = onMessage;

        const headers = this.auth.getHeaders('GET', WS_PATH);

        console.log(`🔐 [KalshiWS] Conectando...`);

        this.ws = new WebSocket(WS_URL, {
            headers: headers,
            perMessageDeflate: false,
            skipUTF8Validation: true
        } as any);

        this.ws.on('open', () => {
            console.log('🔌 [KalshiWS] Conectado!');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.resubscribe();
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                if (this.onMessageCallback) {
                    this.onMessageCallback(JSON.parse(data.toString()));
                }
            } catch (e) {
                // ignore
            }
        });

        this.ws.on('error', (err: Error) => console.error(`❌ [KalshiWS] Erro: ${err.message}`));
        
        this.ws.on('close', () => this.handleDisconnect());
    }

    subscribe(tickers: string | string[]): void {
        const list = Array.isArray(tickers) ? tickers : [tickers];
        let hasNew = false;

        list.forEach(t => {
            if (!this.activeSubscriptions.has(t)) {
                this.activeSubscriptions.add(t);
                hasNew = true;
            }
        });

        if (this.isConnected && list.length > 0) {
            this.sendSubscribe(list);
        }
    }


    public send(data: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
        }
    }

    private sendSubscribe(tickers: string[]): void {
        if (tickers.length === 0) return;

        const payload = {
            id: Date.now(),
            cmd: 'subscribe',
            params: {
                channels: ['orderbook_delta', 'fill'],
                market_tickers: tickers
            }
        };
        
        console.log(`📨 [KalshiWS] Enviando Batch Subscribe para ${tickers.length} mercados...`);
        this.send(payload);
    }

    private resubscribe(): void {
        if (this.activeSubscriptions.size > 0) {
            const allTickers = Array.from(this.activeSubscriptions);
            console.log(`🔄 [KalshiWS] Restaurando inscrição em ${allTickers.length} canais...`);
            this.sendSubscribe(allTickers);
        }
    }

    private handleDisconnect() {
        console.log(`⚠️ [KalshiWS] Desconectado.`);
        this.isConnected = false;
        if (this.isClosing) return;

        if (this.reconnectAttempts < this.MAX_RECONNECTS) {
            const delay = this.BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempts);
            console.log(`⏱️ Reconectando em ${Math.round(delay)}ms...`);
            this.reconnectAttempts++;
            setTimeout(() => this.connect(this.onMessageCallback!), delay);
        } else {
            console.error("❌ Falha crítica: Max reconexões atingido.");
            process.exit(1); 
        }
    }

    public close(): void {
        this.isClosing = true;
        this.activeSubscriptions.clear();
        this.ws?.terminate(); 
    }
}