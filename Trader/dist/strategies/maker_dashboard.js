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
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const auth_1 = require("../exchanges/kalshi/auth");
const stream_ws_1 = require("../exchanges/kalshi/stream_ws");
const book_processor_1 = require("../exchanges/kalshi/book_processor");
const stream_1 = require("../exchanges/polymarket/stream");
// =================================================================
// 🔧 CARREGAMENTO DE ARQUIVOS (SUPORTA ESTRUTURA DE SUBPASTAS)
// =================================================================
function setupEnvironment() {
    // 1. Onde estamos agora? (Pasta 'Typescript')
    const currentDir = process.cwd();
    // 2. Onde pode estar o .env?
    // Opção A: Na pasta atual
    const pathA = path.join(currentDir, '.env');
    // Opção B: Na pasta pai (PredictionMarkets) - CASO DO USUÁRIO
    const pathB = path.join(currentDir, '..', '.env');
    let envFoundPath = '';
    let projectRoot = '';
    if (fs.existsSync(pathA)) {
        envFoundPath = pathA;
        projectRoot = currentDir;
    }
    else if (fs.existsSync(pathB)) {
        envFoundPath = pathB;
        projectRoot = path.join(currentDir, '..');
    }
    else {
        throw new Error(`❌ .env não encontrado em ${currentDir} nem em ${path.join(currentDir, '..')}`);
    }
    console.log(`✅ .env encontrado em: ${envFoundPath}`);
    dotenv.config({ path: envFoundPath });
    return projectRoot; // Retorna a raiz real (onde está o .env e o txt)
}
const REAL_ROOT = setupEnvironment();
// =================================================================
// ⚙️ CONFIGURAÇÃO
// =================================================================
const KALSHI_TICKER = 'KXBRPRES-26-LULA';
const POLY_TOKEN_ID = '30630994248667897740988010928640156931882346081873066002335460180076741328029';
const POLY_IS_YES = true;
const TARGET_PROFIT_CENTS = 2;
let pState = null;
let kState = null;
const fmt = (n) => n ? `$${n.toFixed(3)}` : '   -   ';
const fmtQtd = (n) => n ? Math.floor(n).toString().padStart(7, ' ') : '       ';
function render() {
    if (!pState || !kState)
        return;
    const bestKalshiBid = kState.bids.length > 0 ? kState.bids[0].price : 0;
    const bestPolyYesBid = pState.bids.length > 0 ? pState.bids[0].price : 0;
    const costToBuyNo = bestPolyYesBid > 0 ? (1.00 - bestPolyYesBid) : 1.00;
    const maxSafeBidRaw = 1.00 - (TARGET_PROFIT_CENTS / 100) - costToBuyNo;
    const myKalshiBid = Math.floor(maxSafeBidRaw * 100) / 100;
    let statusFila = "";
    if (myKalshiBid > bestKalshiBid)
        statusFila = "✅ 1º (Líder)";
    else if (myKalshiBid === bestKalshiBid)
        statusFila = "⚠️ Empatado";
    else
        statusFila = `❌ Atrás`;
    console.clear();
    console.log("===============================================================");
    console.log("💎 ARBITRAGEM SINTÉTICA (COMPRA YES + COMPRA NO < $1.00) 💎");
    console.log("===============================================================");
    console.log("");
    console.log(`      🏦 KALSHI (YES BID)      ||      🦅 POLYMARKET (NO ASK)`);
    console.log(`      (Sua Fila de Compra)     ||      (Liquidez p/ Comprar NO)`);
    console.log("-------------------------------||------------------------------");
    console.log(`   QTD   |   PREÇO             ||   PREÇO   |    QTD   `);
    console.log("---------|---------------------||-----------|----------");
    for (let i = 0; i < 3; i++) {
        const kBid = kState.bids[i];
        const kBPrice = kBid ? fmt(kBid.price) : "   -   ";
        const kBSize = kBid ? fmtQtd(kBid.size) : "       ";
        const pYesBid = pState.bids[i];
        let pNoAskPrice = "   -   ";
        let pNoSize = "       ";
        if (pYesBid) {
            const priceNo = 1.00 - pYesBid.price;
            pNoAskPrice = fmt(priceNo);
            pNoSize = fmtQtd(pYesBid.size);
        }
        console.log(` ${kBSize} |  ${kBPrice}            ||  ${pNoAskPrice}  | ${pNoSize}`);
    }
    console.log("-------------------------------||------------------------------");
    const totalCostCurrent = bestKalshiBid + costToBuyNo;
    const potentialProfit = (1.00 - totalCostCurrent) * 100;
    console.log("\n🧮 CENÁRIO ATUAL:");
    console.log(`   Hedge (Poly NO):       ${fmt(costToBuyNo)}`);
    console.log(`   Melhor Bid (Kalshi):   ${fmt(bestKalshiBid)}`);
    console.log(`   SOMA:                  ${fmt(totalCostCurrent)}`);
    if (totalCostCurrent < 1.00) {
        console.log(`   RESULTADO SE BATIDO:   +${potentialProfit.toFixed(1)}¢ (LUCRO) 🟢`);
    }
    else {
        console.log(`   RESULTADO SE BATIDO:   ${potentialProfit.toFixed(1)}¢ (PREJUÍZO) 🔴`);
    }
    console.log("\n🤖 ORDEM SUGERIDA:");
    console.log(`   BID LIMIT NA KALSHI:   ${fmt(myKalshiBid)}`);
    console.log(`   Status: ${statusFila} (Líder é ${fmt(bestKalshiBid)})`);
    console.log(`\n⚡ Atualizado: ${new Date().toLocaleTimeString()}`);
}
async function start() {
    try {
        console.log("🚀 Iniciando Maker Dashboard...");
        const pStream = new stream_1.PolymarketStream(POLY_TOKEN_ID, POLY_IS_YES);
        pStream.connect((state) => {
            pState = state;
            render();
        });
        // --- VALIDAÇÃO DE CHAVES ---
        const kKeyId = process.env.KALSHI_API_KEY;
        const kKeyFile = process.env.KALSHI_API_KEYFILE; // daviglib.txt
        if (!kKeyId || !kKeyFile) {
            throw new Error("❌ Faltam variáveis KALSHI_API_KEY ou KALSHI_API_KEYFILE no .env");
        }
        // Busca o arquivo txt na mesma pasta onde achou o .env (REAL_ROOT)
        const keyFilePath = path.join(REAL_ROOT, kKeyFile);
        console.log(`📂 Lendo chave em: ${keyFilePath}`);
        if (!fs.existsSync(keyFilePath)) {
            throw new Error(`❌ Arquivo '${kKeyFile}' não encontrado na raiz (${REAL_ROOT})`);
        }
        const privateKey = fs.readFileSync(keyFilePath, 'utf8').trim();
        const kAuth = new auth_1.KalshiAuth({ apiKey: kKeyId, privateKey });
        const kStream = new stream_ws_1.KalshiStream(kAuth);
        const kProcessor = new book_processor_1.KalshiBookProcessor(kStream, KALSHI_TICKER);
        kProcessor.start((state) => {
            kState = state;
            render();
        });
        console.log("✅ Dashboard iniciado com sucesso!");
        console.log(`📊 Monitorando: ${KALSHI_TICKER}`);
        console.log(`🦅 Token Polymarket: ${POLY_TOKEN_ID.slice(0, 10)}...`);
        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log("\n🛑 Encerrando...");
            kStream.close();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.log("\n🛑 Encerrando (SIGTERM)...");
            kStream.close();
            process.exit(0);
        });
    }
    catch (e) {
        console.error("\n🔴 ERRO FATAL:");
        console.error(e.message);
        console.error(e.stack);
        process.exit(1);
    }
}
start();
