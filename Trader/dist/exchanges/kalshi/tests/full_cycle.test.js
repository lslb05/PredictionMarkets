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
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const index_1 = require("../index");
const types_1 = require("../../../types");
// Configuração de Caminhos
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../../');
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });
// --- CONFIGURAÇÃO DO TESTE ---
const TICKER = 'KXINXMINY-01JAN2027-6600.01'; // Ativo
const PRECO_TESTE = 0.02; // $0.02 (Bem barato pra não executar na hora)
const QTD_TESTE = 1; // 1 Contrato
// --- GERENCIADOR VISUAL (Igual ao anterior) ---
class Dashboard {
    constructor() {
        this.yesOrders = new Map();
        this.noOrders = new Map();
        this.myOrderId = null; // Vamos rastrear nossa ordem aqui
    }
    processBookMessage(payload) {
        const { type, msg } = payload;
        if (type === 'orderbook_snapshot') {
            this.yesOrders.clear();
            this.noOrders.clear();
            if (msg.yes)
                msg.yes.forEach((l) => this.yesOrders.set(l[0], l[1]));
            if (msg.no)
                msg.no.forEach((l) => this.noOrders.set(l[0], l[1]));
        }
        else if (type === 'orderbook_delta') {
            const target = (msg.side === 'yes') ? this.yesOrders : this.noOrders;
            const newQty = (target.get(msg.price) || 0) + msg.delta;
            if (newQty <= 0)
                target.delete(msg.price);
            else
                target.set(msg.price, newQty);
        }
        this.render();
    }
    render() {
        console.clear();
        console.log(`\n🧪 TESTE DE ORDEM REAL: ${TICKER}`);
        console.log(`🎯 NOSSA ORDEM ALVO: COMPRA DE ${QTD_TESTE} a $${PRECO_TESTE}`);
        if (this.myOrderId)
            console.log(`🆔 ID DA ORDEM: ${this.myOrderId} (Monitorando...)`);
        console.log("\n---------------------------------------------------------");
        console.log("   💚 BID (COMPRA)           ||      ❤️ ASK (VENDA)     ");
        console.log("---------------------------------------------------------");
        // Top 5 Bids e Asks
        const bids = Array.from(this.yesOrders.entries()).map(([p, q]) => ({ p, q })).sort((a, b) => b.p - a.p).slice(0, 5);
        const asks = Array.from(this.noOrders.entries()).map(([p, q]) => ({ p: 100 - p, q })).sort((a, b) => a.p - b.p).slice(0, 5);
        for (let i = 0; i < 5; i++) {
            const b = bids[i];
            const a = asks[i];
            // Lógica visual: Se o preço for igual ao da nossa ordem, coloca um asterisco *
            const isMyPrice = b && (b.p === Math.round(PRECO_TESTE * 100));
            const marker = isMyPrice ? "⬅️ MEU" : "";
            const bPrice = b ? `$${(b.p / 100).toFixed(2)}` : "  -  ";
            const bVol = b ? b.q.toString().padStart(5) : "     ";
            const aPrice = a ? `$${(a.p / 100).toFixed(2)}` : "  -  ";
            const aVol = a ? a.q.toString().padEnd(5) : "     ";
            console.log(`  ${bVol}   |   ${bPrice} ${marker}      ||      ${aPrice}    |  ${aVol}`);
        }
        console.log("---------------------------------------------------------");
    }
}
async function runFullCycle() {
    try {
        // 1. Setup
        const apiKey = process.env.KALSHI_API_KEY;
        const keyFile = process.env.KALSHI_API_KEYFILE;
        const privateKey = fs.readFileSync(path.join(MONOREPO_ROOT, keyFile), 'utf8').trim();
        const kalshi = new index_1.KalshiExchange({ apiKey, privateKey });
        const dashboard = new Dashboard();
        console.log("🔌 Conectando...");
        await kalshi.initialize();
        // 2. Liga o Stream
        kalshi.onOrderBookDelta((d) => dashboard.processBookMessage(d));
        kalshi.subscribeToTicker(TICKER);
        // 3. Aguarda 3 segundos para carregar o Orderbook inicial
        console.log("⏳ Aguardando dados de mercado...");
        await new Promise(r => setTimeout(r, 3000));
        // 4. ENVIA A ORDEM (COMPRA 1 YES a $0.02)
        console.log("\n🚀 ENVIANDO ORDEM LIMIT...");
        const order = await kalshi.createOrder({
            marketId: TICKER,
            side: types_1.OrderSide.BUY,
            type: types_1.OrderType.LIMIT,
            amount: QTD_TESTE,
            price: PRECO_TESTE
        });
        dashboard.myOrderId = order.id;
        console.log(`✅ ORDEM ACEITA! Status: ${order.status}`);
        console.log(`👉 Olhe para o Orderbook acima. O volume no preço $${PRECO_TESTE} deve ter aumentado!`);
        // 5. Deixa rodar por 10 segundos para você ver ela no book
        // Se alguém vender a mercado nesse preço, o evento 'onFill' seria disparado (mas $0.02 é difícil executar)
        let countdown = 10;
        const timer = setInterval(() => {
            process.stdout.write(`\r⏰ Cancelando em ${countdown--}s... `);
        }, 1000);
        await new Promise(r => setTimeout(r, 11000));
        clearInterval(timer);
        // 6. CANCELA A ORDEM
        console.log("\n\n🗑️ CANCELANDO ORDEM...");
        const canceled = await kalshi.cancelOrder(order.id);
        console.log(`✅ ORDEM CANCELADA! Status final: ${canceled.status}`);
        console.log("👉 O volume no Orderbook deve diminuir agora.");
        // Espera um pouco pra ver o update do cancelamento no WS
        await new Promise(r => setTimeout(r, 3000));
        process.exit(0);
    }
    catch (error) {
        console.error("\n❌ ERRO FATAL:", error.message);
        if (error.response)
            console.error("Detalhes:", JSON.stringify(error.response.data, null, 2));
        process.exit(1);
    }
}
runFullCycle();
