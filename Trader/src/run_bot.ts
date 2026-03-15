import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Kalshi Imports
import { KalshiAuth } from './exchanges/kalshi/auth';
import { KalshiApi } from './exchanges/kalshi/api';
import { KalshiStream } from './exchanges/kalshi/stream_ws';
import { KalshiBookProcessor } from './exchanges/kalshi/book_processor';
import { KalshiFillMonitor } from './execution/kalshi_fill_monitor';

// Bot Imports
import { BotEngine, BotStatus } from './execution/bot_engine';

// Polymarket Imports
import { PolymarketAuth } from './exchanges/polymarket/auth'; 
import { PolymarketStream, MarketState } from './exchanges/polymarket/stream';
import { PolymarketExecutor } from './exchanges/polymarket/executor';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CONFIG = {
    KALSHI_TICKER: 'KXFEDDECISION-26MAR-C25',
    POLY_YES_ID: '62938043365772447095885755955446362343142416536419862840923032141775380249586', 
    POLY_NO_ID:  '89036168105179001192755120118050209760422683300339582903158940882158509550672',
    KEY_FILE: process.env.KALSHI_API_KEYFILE,
    
    // ⚙️ GATILHO DE SPREAD
    MIN_PROFIT_TO_OPEN: 3.9,
    
    // ⚙️ EXECUÇÃO REAL
    USE_REAL_HEDGE: true
};

const fmtUSD = (n: number) => `$${n.toFixed(3)}`;
const fmtQty = (n: number) => Math.floor(n).toString().padStart(5, ' ');

// ⚠️ CORREÇÃO 1: Adicionado 'magenta' na tipagem e no objeto de cores
const color = (txt: string, type: 'green' | 'red' | 'yellow' | 'cyan' | 'magenta' | 'reset') => {
    const codes = { 
        green: '\x1b[32m', 
        red: '\x1b[31m', 
        yellow: '\x1b[33m', 
        cyan: '\x1b[36m', 
        magenta: '\x1b[35m', // Nova cor
        reset: '\x1b[0m' 
    };
    return `${codes[type]}${txt}${codes.reset}`;
};

async function main() {
    console.log("🚀 INICIANDO ROBÔ (MAESTRO + HEDGE ASSÍNCRONO)...");

    // 1. SETUP KALSHI
    const keyPath = path.join(__dirname, '../', CONFIG.KEY_FILE!);
    if (!fs.existsSync(keyPath)) throw new Error("Chave Kalshi não encontrada");
    const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
    
    const kAuth = new KalshiAuth({ apiKey: process.env.KALSHI_API_KEY!, privateKey });
    const kApi = new KalshiApi(kAuth);

    // 2. SETUP POLYMARKET
    let polyExecutor: PolymarketExecutor | undefined;
    if (CONFIG.USE_REAL_HEDGE) {
        try {
            const polyAuth = new PolymarketAuth({
                privateKey: process.env.POLYMARKET_PK || '',
                apiKey: process.env.POLYMARKET_API_KEY,
                apiSecret: process.env.POLYMARKET_API_SECRET,
                passphrase: process.env.POLYMARKET_API_PASSPHRASE,
                funderAddress: process.env.POLYMARKET_FUNDER
            });
            polyExecutor = new PolymarketExecutor(polyAuth);
            console.log("🦅 Polymarket: Executor Conectado (Auth Proxy/L2)");
        } catch (e: any) {
            console.error("❌ Erro Auth Poly:", e.message);
            process.exit(1);
        }
    } else {
        console.log("🦅 Polymarket: Modo SIMULAÇÃO");
    }

    // 3. INICIALIZA ENGINE
    const bot = new BotEngine(
        kApi, CONFIG.KALSHI_TICKER, CONFIG.POLY_YES_ID, CONFIG.POLY_NO_ID, CONFIG.MIN_PROFIT_TO_OPEN, polyExecutor
    );

    console.log("🔌 Conectando aos streams...");

    // =========================================================================
    // 🔗 ARQUITETURA MAESTRO
    // =========================================================================
    const kStream = new KalshiStream(kAuth);
    const kProcessor = new KalshiBookProcessor(kStream, CONFIG.KALSHI_TICKER);
    const kFillMonitor = new KalshiFillMonitor(kStream, CONFIG.KALSHI_TICKER);

    kFillMonitor.setCallback((fill) => { bot.onFill(fill); render(); });
    kProcessor.setCallback((state) => { kState = state; tick(); });

    kStream.connect((msg: any) => {
        kFillMonitor.processMessage(msg);
        kProcessor.processMessage(msg);
    });

    setTimeout(() => {
        console.log("📨 Inscrevendo nos canais Kalshi...");
        kStream.subscribe(CONFIG.KALSHI_TICKER); 
        if (typeof kFillMonitor.subscribe === 'function') kFillMonitor.subscribe();
    }, 2500);

    // =========================================================================
    // 🔗 STREAMS POLYMARKET
    // =========================================================================
    new PolymarketStream([CONFIG.POLY_YES_ID], CONFIG.POLY_YES_ID).connect(state => { pYesState = state; tick(); });
    new PolymarketStream([CONFIG.POLY_NO_ID], CONFIG.POLY_NO_ID).connect(state => { pNoState = state; tick(); });

    process.on('SIGINT', async () => {
        console.log("\n🛑 Cancelando ordens...");
        await bot.cancelOrder();
        process.exit();
    });

    let kState: MarketState | null = null;
    let pYesState: MarketState | null = null;
    let pNoState: MarketState | null = null;
    let lastRender = 0;

    const tick = () => {
        if (kState && pYesState && pNoState) {
            bot.onTick(kState, pYesState, pNoState);
        }
        render();
    };

    const render = () => {
        const now = Date.now();
        if (now - lastRender < 200) return;
        lastRender = now;

        const s = bot.getState();
        if (!kState || !pYesState || !pNoState) return;

        console.clear();
        console.log(`================================================================`);
        console.log(`🤖 BOT ARBITRAGEM (HEDGE ASSÍNCRONO) | ALVO: ${CONFIG.KALSHI_TICKER}`);
        console.log(`================================================================\n`);

        // MONITOR
        const sideTxt = s.targetSide === 'yes' ? 'LONG YES' : (s.targetSide === 'no' ? 'LONG NO' : '---');
        console.log(`🎯 Oportunidade:     ${color(sideTxt, 'cyan')}`);
        
        const spreadVal = s.currentSpread.toFixed(2);
        const metaVal = s.minProfit.toFixed(1);
        const spreadColor: any = s.isConditionMet ? 'green' : 'red';
        const statusMsg = s.isConditionMet ? "✅ DENTRO DA META" : "❌ FORA DA META";

        console.log(`💰 Spread Atual:     ${color(spreadVal + '¢', spreadColor)} (Meta: >= ${metaVal}¢)`);
        console.log(`🚦 Condição:         ${statusMsg}`);
        console.log(`----------------------------------------------------------------`);

        // BALDE
        console.log(`🦅 GESTÃO DE RISCO (POLYMARKET)`);
        const filled = Math.min(s.pendingHedgeQty, 5);
        const bar = '█'.repeat(filled) + '░'.repeat(5 - filled);
        let bucketColor: any = s.pendingHedgeQty > 0 ? 'yellow' : 'green';
        if (s.pendingHedgeQty >= 5) bucketColor = 'red';

        console.log(`   Balde de Hedge:   [${color(bar, bucketColor)}] ${s.pendingHedgeQty}/5`);
        
        // ⚠️ CORREÇÃO 2: Removemos 's.isHedgingNow' e confiamos no Enum HEDGING
        if (s.status === BotStatus.STOPPED) {
             console.log(`   AÇÃO:             ${color("⛔ ROBÔ PARADO (ERRO)", 'red')}`);
        } else if (s.status === BotStatus.HEDGING) { 
             // Se estiver hedgiando, o BotEngine já muda o status para HEDGING
             console.log(`   AÇÃO:             ${color("🟣 HEDGE EM ANDAMENTO (BACKGROUND)...", 'magenta')}`);
        } else if (s.pendingHedgeQty >= 5) {
             console.log(`   AÇÃO:             ${color("⚠️ PREPARANDO DISPARO...", 'yellow')}`);
        } else {
             console.log(`   AÇÃO:             Acumulando risco...`);
        }
        console.log(`----------------------------------------------------------------`);

        // KALSHI
        console.log(`⚙️  ORDEM KALSHI`);
        
        let statusColor: any = 'cyan';
        if (s.status === BotStatus.WORKING) statusColor = 'green';
        if (s.status === BotStatus.PLACING) statusColor = 'yellow';
        if (s.status === BotStatus.STOPPED) statusColor = 'red';
        if (s.status === BotStatus.HEDGING) statusColor = 'magenta'; // Nova cor
        
        console.log(`   Estado:           ${color(s.status, statusColor)}`);

        if (s.activeOrderId) {
            console.log(`   Ordem Viva:       [${s.activeOrderSide?.toUpperCase()}] ${s.activeOrderSize} un. @ ${s.activeOrderPrice}¢`);
            console.log(`   ID:               ${s.activeOrderId}`);
        } else {
            console.log(`   Ordem Viva:       --`);
        }
        
        // BOOK
        if (s.targetSide) {
            const labelK = s.targetSide === 'yes' ? 'KALSHI BID (YES)' : 'KALSHI BID (NO)';
            const labelP = s.targetSide === 'yes' ? 'POLY ASK (NO)'    : 'POLY ASK (YES)';
            
            console.log(`\n📊 BOOK (Foco: ${s.targetSide.toUpperCase()})`);
            console.log(`   ${labelK.padEnd(20)} || ${labelP.padEnd(20)}`);
            console.log(`   Qtd   | Preço        || Preço        | Qtd`);
            console.log(`------------------------||----------------------`);

            for(let i=0; i<3; i++) {
                let kBid, pAsk;
                if (s.targetSide === 'yes') { kBid = kState.bids[i]; pAsk = pNoState?.asks[i]; } 
                else { kBid = kState.asks[i]; pAsk = pYesState?.asks[i]; }

                const kP = kBid ? kBid.price : 0; const kS = kBid ? kBid.size : 0;
                const pP = pAsk ? pAsk.price : 1; const pS = pAsk ? pAsk.size : 0;

                let mark = "  ";
                if (s.activeOrderId && s.activeOrderPrice === kP && s.activeOrderSide === s.targetSide) mark = "👉";
                console.log(`${mark} ${fmtQty(kS)} | ${fmtUSD(kP)}      || ${fmtUSD(pP)}      | ${fmtQty(pS)}`);
            }
        }
        console.log(`\n================================================================`);
    };
}

main().catch(console.error);