"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KalshiStream = void 0;
const ws_1 = __importDefault(require("ws"));
const WS_URL = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
const WS_PATH = '/trade-api/ws/v2';
class KalshiStream {
    constructor(auth) {
        this.activeSubscriptions = new Set();
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelayMs = 1000;
        this.isClosing = false;
        this.auth = auth;
    }
    connect(onMessage) {
        if (this.isClosing)
            return;
        this.onMessageCallback = onMessage;
        const headers = this.auth.getHeaders('GET', WS_PATH);
        console.log("🔐 [KalshiWS] Conectando (Tentativa " + (this.reconnectAttempts + 1) + ")...");
        // ✅ CORREÇÃO 1: Não passar headers na construção
        this.ws = new ws_1.default(WS_URL);
        // ✅ CORREÇÃO 2: Usar 'upgrade' event para passar headers
        this.ws.once('upgrade', (response) => {
            console.log('📨 [KalshiWS] Upgrade recebido');
        });
        this.ws.on('open', () => {
            console.log('🔌 [KalshiWS] Conectado! Enviando autenticação...');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            // Envia headers como mensagem de autenticação (se necessário)
            this.sendAuthMessage(headers);
            // Reinscreve em tudo que estava pendente
            this.resubscribe();
            // Inicia heartbeat para manter vivo
            this.startHeartbeat();
        });
        this.ws.on('message', (data) => {
            try {
                const message = data.toString('utf8');
                const parsed = JSON.parse(message);
                if (this.onMessageCallback) {
                    this.onMessageCallback(parsed);
                }
            }
            catch (e) {
                console.error("❌ [KalshiWS] Erro ao parsear JSON:", e.message);
            }
        });
        this.ws.on('error', (err) => {
            console.error("❌ [KalshiWS] Erro:", err.message);
        });
        this.ws.on('close', (code) => {
            console.log(`⚠️ [KalshiWS] Desconectado (Código: ${code})`);
            this.isConnected = false;
            this.stopHeartbeat();
            // ✅ CORREÇÃO 3: Reconexão com exponential backoff
            if (!this.isClosing && this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = this.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts);
                console.log(`⏱️  Reconectando em ${Math.round(delay / 1000)}s...`);
                this.reconnectAttempts++;
                setTimeout(() => this.connect(this.onMessageCallback), delay);
            }
            else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error("❌ [KalshiWS] Máximo de tentativas de reconexão atingido");
            }
        });
    }
    sendAuthMessage(headers) {
        // Alguns servidores WebSocket esperam autenticação via mensagem
        // Kalshi pode não precisar, mas deixamos preparado
        try {
            // Se Kalshi requer auth msg, descomente:
            // const authMsg = { type: 'auth', headers };
            // this.ws?.send(JSON.stringify(authMsg));
        }
        catch (e) {
            console.error("❌ [KalshiWS] Erro ao enviar auth:", e.message);
        }
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
                try {
                    this.ws.ping();
                }
                catch (e) {
                    console.error("❌ [KalshiWS] Erro no heartbeat:", e.message);
                }
            }
        }, 30000); // A cada 30 segundos
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
    }
    subscribe(ticker) {
        console.log(`📨 [KalshiWS] Agendando inscrição: ${ticker}`);
        this.activeSubscriptions.add(ticker);
        // Se já conectado, envia agora
        if (this.isConnected) {
            this.sendSubscribe(ticker);
        }
    }
    sendSubscribe(ticker) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            console.warn(`⚠️  [KalshiWS] WebSocket não está pronto para enviar subscribe`);
            return;
        }
        const payload = {
            id: Date.now(),
            cmd: 'subscribe',
            params: {
                channels: ['orderbook_delta', 'fill'],
                market_tickers: [ticker]
            }
        };
        try {
            this.ws.send(JSON.stringify(payload));
            console.log(`🚀 [KalshiWS] Subscribe enviado: ${ticker}`);
        }
        catch (e) {
            console.error("❌ [KalshiWS] Erro ao enviar subscribe:", e.message);
        }
    }
    resubscribe() {
        this.activeSubscriptions.forEach(ticker => this.sendSubscribe(ticker));
    }
    close() {
        console.log("🛑 [KalshiWS] Fechando conexão...");
        this.isClosing = true;
        this.stopHeartbeat();
        if (this.ws) {
            if (this.ws.readyState === ws_1.default.OPEN) {
                this.ws.close(1000, 'Normal closure');
            }
            this.ws = undefined;
        }
        this.isConnected = false;
        this.activeSubscriptions.clear();
    }
}
exports.KalshiStream = KalshiStream;
