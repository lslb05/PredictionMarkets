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
// Ajuste o caminho dos imports conforme sua estrutura (suba quantos níveis precisar)
const types_1 = require("../../../types"); // ou '../../../types'
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../../');
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });
// --- CONFIGURAÇÃO ---
const TICKER = 'KXINXMINY-01JAN2027-6600.01';
const SPREAD_ALVO = 3;
const QTD_LOTE = 5;
const PRECO_FIXO = 0.02;
// --- DASHBOARD ---
class Dashboard {
    constructor() {
        this.yesOrders = new Map();
        this.noOrders = new Map();
        this.orderState = null;
        this.lastSpread = 0;
        this.botState = "INICIANDO...";
    }
    updateBook(msg) {
        if (msg.type === 'orderbook_snapshot') {
            this.yesOrders.clear();
            this.noOrders.clear();
            if (msg.msg.yes)
                msg.msg.yes.forEach((l) => this.yesOrders.set(l[0], l[1]));
            if (msg.msg.no)
                msg.msg.no.forEach((l) => this.noOrders.set(l[0], l[1]));
        }
        else if (msg.type === 'orderbook_delta') {
            const target = (msg.msg.side === 'yes') ? this.yesOrders : this.noOrders;
            const newQty = (target.get(msg.msg.price) || 0) + msg.msg.delta;
            if (newQty <= 0)
                target.delete(msg.msg.price);
            else
                target.set(msg.msg.price, newQty);
        }
        this.render();
    }
    getBestBid() {
        const prices = Array.from(this.yesOrders.keys());
        return prices.length > 0 ? Math.max(...prices) : 0;
    }
    getBestAsk() {
        const noPrices = Array.from(this.noOrders.keys());
        const bestBidNo = noPrices.length > 0 ? Math.max(...noPrices) : 0;
        return bestBidNo > 0 ? (100 - bestBidNo) : 100;
    }
    render() {
        console.clear();
        console.log(`🤖 SPREAD BOT V2 | Ticker: ${TICKER}`);
        console.log(`⚡ Estado: ${this.botState}`);
        console.log(`📉 Spread: ${this.lastSpread} cents (Alvo: >= ${SPREAD_ALVO})`);
        console.log("\n📋 --- MINHA ORDEM ATUAL ---");
        if (this.orderState) {
            const o = this.orderState;
            const progress = o.filledQty === o.totalQty ? "[█████]" : "[░░░░░]";
            console.log(`🆔 ID:     ${o.id}`);
            console.log(`💲 Preço:  $${o.price.toFixed(2)}`);
            console.log(`📦 Qtd:    ${o.totalQty}`);
            console.log(`✅ Filled: ${o.filledQty} ${progress}`);
            console.log(`📊 Status: ${o.status}`);
        }
        else {
            console.log("   (Nenhuma ordem ativa no momento)");
        }
        console.log("----------------------------");
        console.log("\n   💚 BID (COMPRA)           ||      ❤️ ASK (VENDA)     ");
        console.log("---------------------------------------------------------");
        const bids = Array.from(this.yesOrders.entries()).map(([p, q]) => ({ p, q })).sort((a, b) => b.p - a.p).slice(0, 5);
        const asks = Array.from(this.noOrders.entries()).map(([p, q]) => ({ p: 100 - p, q })).sort((a, b) => a.p - b.p).slice(0, 5);
        for (let i = 0; i < 5; i++) {
            const b = bids[i];
            const a = asks[i];
            // Marcação visual: Checa se o orderState existe e se o preço bate
            const isMyPrice = this.orderState && b && (b.p === Math.round(this.orderState.price * 100));
            const marker = isMyPrice ? "⬅️ (EU)" : "";
            const bPrice = b ? `$${(b.p / 100).toFixed(2)}` : "  -  ";
            const bVol = b ? b.q.toString().padStart(5) : "     ";
            const aPrice = a ? `$${(a.p / 100).toFixed(2)}` : "  -  ";
            const aVol = a ? a.q.toString().padEnd(5) : "     ";
            console.log(`  ${bVol}   |   ${bPrice} ${marker}      ||      ${aPrice}    |  ${aVol}`);
        }
        console.log("---------------------------------------------------------");
    }
}
async function runBot() {
    try {
        const apiKey = process.env.KALSHI_API_KEY;
        const keyFile = process.env.KALSHI_API_KEYFILE;
        const privateKey = fs.readFileSync(path.join(MONOREPO_ROOT, keyFile), 'utf8').trim();
        const kalshi = new index_1.KalshiExchange({ apiKey, privateKey });
        const dash = new Dashboard();
        let currentOrder = null;
        let isProcessing = false;
        await kalshi.initialize();
        // ============================================================
        // 🛡️ RECONCILIAÇÃO DE ESTADO (CORRIGIDO)
        // ============================================================
        console.log("🔍 [INIT] Buscando ordens abertas na API...");
        // Busca todas (o filtro de ticker é feito no client-side dentro do fetchOpenOrders ou aqui)
        const openOrders = await kalshi.fetchOpenOrders(TICKER);
        // DEBUG: Mostra o que achou para você entender se duplicou
        console.log(`🔍 [DEBUG] API retornou ${openOrders.length} ordens para este ticker.`);
        if (openOrders.length > 0) {
            console.log("   -> IDs encontrados:", openOrders.map(o => `${o.id} ($${o.price})`).join(', '));
        }
        if (openOrders.length > 0) {
            // Tenta achar a ordem "Certa" (Mesmo preço, Lado COMPRA)
            const recovered = openOrders.find(o => {
                // CORREÇÃO TS: Garante que price existe antes de fazer conta
                if (o.price === undefined)
                    return false;
                return Math.abs(o.price - PRECO_FIXO) < 0.001 && o.side === types_1.OrderSide.BUY;
            });
            if (recovered && recovered.price !== undefined) {
                // ADOTA A ORDEM
                currentOrder = {
                    id: recovered.id,
                    price: recovered.price, // TS agora sabe que é number
                    totalQty: recovered.amount,
                    filledQty: recovered.filled,
                    status: 'OPEN (RECUPERADA)',
                    side: 'BUY'
                };
                dash.orderState = currentOrder;
                dash.botState = "♻️ ORDEM RECUPERADA";
                console.log(`✅ [RECOVERY] Ordem ${recovered.id.slice(0, 5)}... adotada com sucesso!`);
            }
            // Se achou ordens, mas não a que queríamos, OU se sobrou lixo duplicado:
            // Vamos cancelar TUDO que não seja a "recovered" para limpar a duplicação
            const ordersToCancel = openOrders.filter(o => !currentOrder || o.id !== currentOrder.id);
            if (ordersToCancel.length > 0) {
                console.log(`🗑️ [CLEANUP] Cancelando ${ordersToCancel.length} ordens duplicadas/estranhas...`);
                for (const oldOrder of ordersToCancel) {
                    try {
                        await kalshi.cancelOrder(oldOrder.id);
                        console.log(`   -> Cancelada: ${oldOrder.id.slice(0, 5)}...`);
                    }
                    catch (err) {
                        console.log(`   -> Falha ao cancelar ${oldOrder.id} (Já sumiu?)`);
                    }
                }
            }
        }
        else {
            console.log("✅ [INIT] Nenhuma ordem aberta encontrada. Começando limpo.");
        }
        // Pausa dramática para ler os logs antes de limpar a tela
        await new Promise(r => setTimeout(r, 4000));
        dash.render();
        // ============================================================
        // --- WEBSOCKET FILL HANDLER ---
        kalshi.onFill((fillMsg) => {
            if (currentOrder && fillMsg.order_id === currentOrder.id) {
                currentOrder.filledQty += fillMsg.count;
                if (currentOrder.filledQty >= currentOrder.totalQty) {
                    currentOrder.status = 'FILLED ✅';
                    dash.botState = "💰 ORDEM EXECUTADA TOTALMENTE!";
                }
                else {
                    currentOrder.status = 'PARTIALLY FILLED ⚠️';
                    dash.botState = "💰 EXECUÇÃO PARCIAL!";
                }
                dash.orderState = currentOrder;
                dash.render();
            }
        });
        // --- WEBSOCKET BOOK HANDLER ---
        kalshi.onOrderBookDelta(async (msg) => {
            dash.updateBook(msg);
            const bestBid = dash.getBestBid();
            const bestAsk = dash.getBestAsk();
            if (bestBid === 0 || bestAsk === 100)
                return;
            const spread = bestAsk - bestBid;
            dash.lastSpread = spread;
            if (isProcessing)
                return;
            // REGRA DE ENTRADA
            const semOrdemAtiva = !currentOrder || currentOrder.status === 'CANCELED' || currentOrder.status === 'FILLED ✅';
            if (spread >= SPREAD_ALVO && semOrdemAtiva) {
                isProcessing = true;
                dash.botState = "🚀 CRIANDO ORDEM...";
                dash.render();
                try {
                    const res = await kalshi.createOrder({
                        marketId: TICKER,
                        side: types_1.OrderSide.BUY,
                        type: types_1.OrderType.LIMIT,
                        price: PRECO_FIXO,
                        amount: QTD_LOTE
                    });
                    currentOrder = {
                        id: res.id,
                        price: PRECO_FIXO,
                        totalQty: QTD_LOTE,
                        filledQty: 0,
                        status: 'OPEN',
                        side: 'BUY'
                    };
                    dash.orderState = currentOrder;
                    dash.botState = "✅ POSICIONADO";
                }
                catch (e) {
                    dash.botState = `❌ ERRO: ${e.message}`;
                }
                finally {
                    isProcessing = false;
                    dash.render();
                }
            }
            // REGRA DE SAÍDA (Spread Fechou)
            else if (spread < SPREAD_ALVO && currentOrder && (currentOrder.status === 'OPEN' || currentOrder.status === 'PARTIALLY FILLED ⚠️' || currentOrder.status === 'OPEN (RECUPERADA)')) {
                isProcessing = true;
                dash.botState = "⚠️ SPREAD FECHOU -> CANCELANDO";
                dash.render();
                try {
                    await kalshi.cancelOrder(currentOrder.id);
                    currentOrder.status = 'CANCELED';
                    dash.orderState = currentOrder;
                    dash.botState = "💤 AGUARDANDO...";
                }
                catch (e) {
                    dash.botState = "⚠️ FALHA AO CANCELAR (Já executou?)";
                    currentOrder = null;
                    dash.orderState = null;
                }
                finally {
                    isProcessing = false;
                    dash.render();
                }
            }
        });
        kalshi.subscribeToTicker(TICKER);
    }
    catch (error) {
        console.error("Fatal:", error.message);
    }
}
runBot();
