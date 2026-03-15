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
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../../');
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });
class LocalOrderBook {
    constructor() {
        // Armazena dados brutos (Raw Data)
        this.yesOrders = new Map(); // Preço -> Qtd
        this.noOrders = new Map(); // Preço -> Qtd
    }
    processMessage(payload) {
        const type = payload.type;
        const data = payload.msg;
        // 1. SNAPSHOT (Limpa e preenche)
        if (type === 'orderbook_snapshot') {
            this.yesOrders.clear();
            this.noOrders.clear();
            if (data.yes)
                data.yes.forEach((l) => this.yesOrders.set(l[0], l[1]));
            if (data.no)
                data.no.forEach((l) => this.noOrders.set(l[0], l[1]));
            this.printBook(data.market_ticker);
        }
        // 2. DELTA (Atualiza incremental)
        else if (type === 'orderbook_delta') {
            const price = data.price;
            const delta = data.delta;
            const side = data.side; // "yes" ou "no"
            const targetMap = (side === 'yes') ? this.yesOrders : this.noOrders;
            const currentQty = targetMap.get(price) || 0;
            const newQty = currentQty + delta;
            if (newQty <= 0)
                targetMap.delete(price);
            else
                targetMap.set(price, newQty);
            this.printBook(data.market_ticker);
        }
    }
    printBook(ticker) {
        // --- TRANSFORMAÇÃO PARA BID/ASK ---
        // 1. Monta BIDS (Compradores de YES)
        // Ordena do Maior para o Menor (Quem paga mais fica no topo)
        const bids = Array.from(this.yesOrders.entries())
            .map(([price, qty]) => ({ price, qty }))
            .sort((a, b) => b.price - a.price)
            .slice(0, 5); // Top 5
        // 2. Monta ASKS (Vendedores de YES)
        // Convertemos as ordens de "NO" para "Asks do YES"
        // Preço Ask = 100 - Preço do No
        const asks = Array.from(this.noOrders.entries())
            .map(([noPrice, qty]) => ({
            price: 100 - noPrice, // A inversão mágica
            qty: qty
        }))
            .sort((a, b) => a.price - b.price) // Ordena do Menor para o Maior (Venda mais barata no topo)
            .slice(0, 5); // Top 5
        // --- RENDERIZAÇÃO ---
        console.clear();
        console.log(`\n📊 ORDERBOOK (VISÃO DO CONTRATO 'YES'): ${ticker}`);
        console.log(`🕒 ${new Date().toLocaleTimeString()}`);
        console.log("=========================================================");
        console.log("   💚 BID (COMPRA)           ||      ❤️ ASK (VENDA)     ");
        console.log("=========================================================");
        console.log("   Qtd    |  Preço($)        ||      Preço($)  |   Qtd   ");
        console.log("---------------------------------------------------------");
        for (let i = 0; i < 5; i++) {
            const b = bids[i];
            const a = asks[i];
            // Formatação Bid (Lado Esquerdo)
            const bVol = b ? b.qty.toString().padStart(5) : "     ";
            const bPrice = b ? `$${(b.price / 100).toFixed(2)}` : "  -  ";
            // Formatação Ask (Lado Direito)
            const aPrice = a ? `$${(a.price / 100).toFixed(2)}` : "  -  ";
            const aVol = a ? a.qty.toString().padEnd(5) : "     ";
            console.log(`  ${bVol}   |   ${bPrice}        ||      ${aPrice}    |  ${aVol}`);
        }
        console.log("---------------------------------------------------------");
        // Exibe o Spread atual
        if (bids[0] && asks[0]) {
            const spread = (asks[0].price - bids[0].price);
            console.log(`⚡ SPREAD: $${(spread / 100).toFixed(2)} (${spread} cents)`);
        }
        else {
            console.log("⚡ SPREAD: --");
        }
    }
}
async function runRealTimeTest() {
    try {
        const apiKey = process.env.KALSHI_API_KEY;
        const keyFileName = process.env.KALSHI_API_KEYFILE;
        const keyPath = path.join(MONOREPO_ROOT, keyFileName);
        const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
        const kalshi = new index_1.KalshiExchange({ apiKey, privateKey });
        const book = new LocalOrderBook();
        console.log("Conectando...");
        await kalshi.initialize();
        // Ticker ativo (Certifique-se que este ticker tem volume!)
        //const TICKER = 'KXBRPRES-26-FBOL'; 
        const TICKER = 'KXINXMINY-01JAN2027-6600.01';
        kalshi.onOrderBookDelta((fullMessage) => {
            if (fullMessage.msg.market_ticker === TICKER) {
                book.processMessage(fullMessage);
            }
        });
        console.log(`Assinando ${TICKER}...`);
        kalshi.subscribeToTicker(TICKER);
        setInterval(() => { }, 1000);
    }
    catch (error) {
        console.error("❌ ERRO:", error.message);
    }
}
runRealTimeTest();
