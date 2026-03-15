"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../../');
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });
// =================================================================
// ⚙️ CONFIGURAÇÃO
// =================================================================
const TARGET_ASSET_ID = "79191939610100241429039499950443680906623179487184628479206155805558220344190";
const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
// 🚨 IMPORTANTE: Mude para 'false' se os preços parecerem invertidos (Ex: YES deveria ser 99c mas aparece 1c)
const IS_YES_TOKEN = false;
// =================================================================
// 🧠 LÓGICA DO MONITOR
// =================================================================
class PolyWSMonitor {
    constructor() {
        this.bids = new Map();
        this.asks = new Map();
    }
    start() {
        console.log("🔌 Conectando ao WebSocket do Polymarket...");
        const ws = new ws_1.default(WS_URL);
        ws.on('open', () => {
            console.log("✅ Conectado! Enviando subscrição...");
            const msg = {
                assets_ids: [TARGET_ASSET_ID],
                type: "market"
            };
            ws.send(JSON.stringify(msg));
        });
        ws.on('message', (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                const events = Array.isArray(parsed) ? parsed : [parsed];
                let needRefresh = false;
                for (const event of events) {
                    if (this.processEvent(event))
                        needRefresh = true;
                }
                if (needRefresh)
                    this.render();
            }
            catch (err) {
                console.error("Erro no parse:", err);
            }
        });
        ws.on('error', (err) => console.error("Erro WS:", err));
        ws.on('close', () => console.log("🛑 Conexão fechada."));
    }
    processEvent(event) {
        const type = event.event_type;
        if (type === "book") {
            if (event.asset_id !== TARGET_ASSET_ID)
                return false;
            this.bids.clear();
            this.asks.clear();
            event.bids.forEach((x) => this.bids.set(parseFloat(x.price), parseFloat(x.size)));
            event.asks.forEach((x) => this.asks.set(parseFloat(x.price), parseFloat(x.size)));
            return true;
        }
        if (type === "price_change") {
            const changes = event.price_changes || [];
            let updated = false;
            for (const change of changes) {
                if (change.asset_id !== TARGET_ASSET_ID)
                    continue;
                updated = true;
                const price = parseFloat(change.price);
                const size = parseFloat(change.size);
                const targetMap = (change.side === "BUY") ? this.bids : this.asks;
                if (size === 0)
                    targetMap.delete(price);
                else
                    targetMap.set(price, size);
            }
            return updated;
        }
        return false;
    }
    fmt(price, size) {
        const cents = (price * 100).toFixed(1);
        return `${cents}¢ (${Math.floor(size)})`;
    }
    render() {
        process.stdout.write('\x1Bc');
        // Ordenação
        const sortedBids = Array.from(this.bids.entries()).sort((a, b) => b[0] - a[0]); // Maior -> Menor
        const sortedAsks = Array.from(this.asks.entries()).sort((a, b) => a[0] - b[0]); // Menor -> Maior
        // Pega os melhores preços do token MONITORADO (Direto)
        let directBid = 0, directBidStr = "-----";
        if (sortedBids.length > 0) {
            directBid = sortedBids[0][0];
            directBidStr = this.fmt(directBid, sortedBids[0][1]);
        }
        let directAsk = 0, directAskStr = "-----";
        if (sortedAsks.length > 0) {
            directAsk = sortedAsks[0][0];
            directAskStr = this.fmt(directAsk, sortedAsks[0][1]);
        }
        // Calcula o INVERSO (Sintético)
        // Bid Inverso = 1 - Ask Direto
        let synthBidStr = "-----";
        if (directAsk > 0) {
            synthBidStr = this.fmt(1.0 - directAsk, sortedAsks[0][1]);
        }
        // Ask Inverso = 1 - Bid Direto
        let synthAskStr = "-----";
        if (directBid > 0) {
            synthAskStr = this.fmt(1.0 - directBid, sortedBids[0][1]);
        }
        // --- DEFINIÇÃO DE QUEM É QUEM ---
        let labelDireto = IS_YES_TOKEN ? "YES (Direto)" : "NO (Direto)";
        let labelSintetico = IS_YES_TOKEN ? "NO (Sintético)" : "YES (Sintético)";
        let colorDireto = IS_YES_TOKEN ? "🟢" : "🔴";
        let colorSintetico = IS_YES_TOKEN ? "🔴" : "🟢";
        // Se o token for NO, o "Sintético" (YES) é o principal que queremos ver
        // Então vamos exibir na ordem correta: YES sempre em cima para facilitar
        const showYesFirst = true;
        console.log(`=====================================================`);
        console.log(`🦅 POLYMARKET STREAM | ID: ${TARGET_ASSET_ID.slice(0, 10)}...`);
        console.log(`=====================================================`);
        if (IS_YES_TOKEN) {
            // Caso padrão: Token é YES
            console.log(`${colorDireto} ${labelDireto}`);
            console.log(`    BID:   [${directBidStr}]`);
            console.log(`    ASK:   [${directAskStr}]`);
            console.log("");
            console.log(`${colorSintetico} ${labelSintetico}`);
            console.log(`    BID:   [${synthBidStr}]`);
            console.log(`    ASK:   [${synthAskStr}]`);
        }
        else {
            // Caso invertido: Token é NO (Mas mostramos YES em cima pra não confundir)
            console.log(`${colorSintetico} ${labelSintetico}`);
            console.log(`    BID:   [${synthBidStr}]`);
            console.log(`    ASK:   [${synthAskStr}]`);
            console.log("");
            console.log(`${colorDireto} ${labelDireto}`);
            console.log(`    BID:   [${directBidStr}]`);
            console.log(`    ASK:   [${directAskStr}]`);
        }
        console.log("-----------------------------------------------------");
        // Spread é sempre Ask - Bid (do que estivermos olhando)
        if (directBid && directAsk) {
            const spread = (directAsk - directBid) * 100;
            console.log(`📉 SPREAD: ${spread.toFixed(1)}¢`);
        }
        console.log(`=====================================================`);
    }
}
const monitor = new PolyWSMonitor();
monitor.start();
