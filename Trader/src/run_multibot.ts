import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { KalshiAuth } from './exchanges/kalshi/auth';
import { KalshiApi } from './exchanges/kalshi/api';
import { KalshiStream } from './exchanges/kalshi/stream_ws';
import { KalshiBookProcessor } from './exchanges/kalshi/book_processor';
import { KalshiFillMonitor } from './execution/kalshi_fill_monitor';
import { BotEngine } from './execution/bot_engine';
import { MARKETS } from './markets_config';
import { PolymarketAuth } from './exchanges/polymarket/auth'; 
import { PolymarketStream, MarketState } from './exchanges/polymarket/stream_multi'; // Verifique se o nome do arquivo está certo
import { PolymarketExecutor } from './exchanges/polymarket/executor';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CONFIG = {
    KEY_FILE: process.env.KALSHI_API_KEYFILE ,
    USE_REAL_HEDGE: true
};

const botsByKalshiTicker = new Map<string, BotEngine>();
const botsByPolyToken = new Map<string, BotEngine>();

const marketStateCache = new Map<string, MarketState>();

async function main() {
    console.log(`🚀 INICIANDO ORQUESTRADOR MULTI-MERCADO (${MARKETS.length} ativos)...`);
    const keyPath = path.join(__dirname, '../', CONFIG.KEY_FILE!);
    const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
    const kAuth = new KalshiAuth({ apiKey: process.env.KALSHI_API_KEY!, privateKey });
    const kApi = new KalshiApi(kAuth);
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
            console.log(" Polymarket Executor: CONECTADO (Compartilhado)");
        } catch (e: any) {
            console.error("❌ Erro Auth Poly:", e.message);
        }
    }

    const allPolyIds: string[] = [];
    const allKalshiTickers: string[] = [];

    MARKETS.forEach(conf => {
        const bot = new BotEngine(
            kApi, 
            conf.kalshiTicker, 
            conf.polyYesId, 
            conf.polyNoId, 
            conf.minProfit, 
            polyExecutor
        );

        botsByKalshiTicker.set(conf.kalshiTicker, bot);
        botsByPolyToken.set(conf.polyYesId, bot);
        botsByPolyToken.set(conf.polyNoId, bot);

        allPolyIds.push(conf.polyYesId, conf.polyNoId);
        allKalshiTickers.push(conf.kalshiTicker);
    });

    const kStream = new KalshiStream(kAuth);
    
    const processors: KalshiBookProcessor[] = [];
    const monitors: KalshiFillMonitor[] = [];

    MARKETS.forEach(conf => {
        const bot = botsByKalshiTicker.get(conf.kalshiTicker);
        if(!bot) return;

        const proc = new KalshiBookProcessor(kStream, conf.kalshiTicker);
        proc.setCallback((state) => {
            marketStateCache.set(conf.kalshiTicker, state);
            tryTickBot(bot);
        });
        processors.push(proc);

        const mon = new KalshiFillMonitor(kStream, conf.kalshiTicker);
        mon.setCallback((fill) => bot.onFill(fill));
        monitors.push(mon);
    });

    kStream.connect((msg: any) => {
        processors.forEach(p => p.processMessage(msg));
        monitors.forEach(m => m.processMessage(msg));
    });

    setTimeout(() => {
        console.log("📨 Inscrevendo canais Kalshi (BATCH)...");
        
        if (allKalshiTickers.length > 0) {
            kStream.subscribe(allKalshiTickers);
        }
        
    }, 2500);


    const pStream = new PolymarketStream(allPolyIds);
    
    pStream.connect((tokenId: string, state: MarketState) => {
        marketStateCache.set(tokenId, state);

        const bot = botsByPolyToken.get(tokenId);
        
        if(bot) tryTickBot(bot);
    });

    setInterval(() => renderSummary(), 1000);
}
function tryTickBot(bot: BotEngine) {
    const kState = marketStateCache.get(bot.ticker);
    const pYesState = marketStateCache.get(bot.polyYesId);
    const pNoState = marketStateCache.get(bot.polyNoId);

    if (kState && pYesState && pNoState) {
        bot.onTick(kState, pYesState, pNoState);
    }
}

function renderSummary() {
    console.clear();
    console.log(`🤖 MULTI-MARKET BOT | Rodando ${MARKETS.length} Mercados`);
    console.log(`===================================================================================================================`);
    // Ajustei levemente o espaçamento para caber o decimal
    console.log(`| MERCADO           | STATUS    | LADO | SPREAD | META | K-BID (Top)   | P-ASK (Top)    | RISCO | ORDEM ATIVA    |`);
    console.log(`|-------------------|-----------|------|--------|------|---------------|----------------|-------|----------------|`);

    botsByKalshiTicker.forEach((bot, ticker) => {
        // --- 1. PREPARAÇÃO DOS DADOS ---
        const conf = MARKETS.find(m => m.kalshiTicker === ticker);
        const name = (conf ? conf.name : ticker).substring(0, 15).padEnd(17);
        const s = bot.getState();

        const kState = marketStateCache.get(ticker);
        const pYes = marketStateCache.get(bot.polyYesId);
        const pNo  = marketStateCache.get(bot.polyNoId);

        const targetSide = s.targetSide || 'yes';
        
        let kBookSide: any[] = [];
        let pBookSide: any[] = [];
        let labelSide = "";

        if (kState && pYes && pNo) {
            if (targetSide === 'yes') {
                kBookSide = kState.bids;
                pBookSide = pNo.asks;
                labelSide = "YES";
            } else {
                kBookSide = kState.asks; 
                pBookSide = pYes.asks;
                labelSide = "NO";
            }
        }
        
        let statusColor = '\x1b[37m'; 
        if (s.status === '🟢 WORKING') statusColor = '\x1b[32m';
        if (s.status === '🟣 HEDGING') statusColor = '\x1b[35m';
        if (!s.isConditionMet) statusColor = '\x1b[90m'; 

        const statusStr = s.status.split(' ')[1].padEnd(9);
        const spreadStr = s.currentSpread.toFixed(2).padStart(6);
        const metaStr = s.minProfit.toFixed(1).padStart(4);
        const hedgeStr = `${s.pendingHedgeQty}/5`.padStart(5);
        
        const topK = kBookSide[0] ? (kBookSide[0].price * 100).toFixed(0) + '¢' : '--';
        const topP = pBookSide[0] ? (pBookSide[0].price * 100).toFixed(1) + '¢' : '--';

        let orderTxt = "--";
        if (s.activeOrderId) {
            orderTxt = `${s.activeOrderSide?.toUpperCase().charAt(0)} ${s.activeOrderSize}@${s.activeOrderPrice}¢`;
        }
        
        let rowColor = '\x1b[0m';
        if (s.currentSpread >= s.minProfit) rowColor = '\x1b[32m';
        else if (s.currentSpread < 0) rowColor = '\x1b[31m';

        console.log(
            `${statusColor}| ${name} | ${statusStr} | ${labelSide.padEnd(4)} |` + 
            `${rowColor} ${spreadStr} | ${metaStr} | ${topK.padStart(13)} | ${topP.padStart(14)} |` + 
            `\x1b[0m ${hedgeStr} | ${orderTxt.padEnd(15)}|`
        );

        //  MINI ORDER BOOK ---
        if (kBookSide.length > 0 || pBookSide.length > 0) {
            console.log(`|   └─ 📊 BOOK:     \x1b[90mKALSHI BID (Qtd @ Preço)     ||      POLY ASK (Preço @ Qtd)\x1b[0m`);
            
            for (let i = 0; i < 3; i++) {
                const kItem = kBookSide[i];
                const pItem = pBookSide[i];

                let kText = "          --";
                if (kItem) {
                    const price = Math.round(kItem.price * 100);
                    const size = Math.floor(kItem.size).toString().padStart(5, ' ');
                    
                    if (s.activeOrderId && Math.abs(s.activeOrderPrice - price) < 0.1 && i === 0) {
                         kText = `\x1b[36m${size} @ ${price}¢\x1b[0m`;
                    } else {
                         kText = `${size} @ ${price}¢`;
                    }
                }

                let pText = "--           ";
                if (pItem) {
                    const price = (pItem.price * 100).toFixed(1); 
                    const size = Math.floor(pItem.size).toString().padEnd(5, ' ');
                    pText = `${price}¢ @ ${size}`;
                }

                console.log(`|                   ${kText}        \x1b[90m||\x1b[0m       ${pText}`);
            }
            console.log(`|`); 
        }
    });
    console.log(`===================================================================================================================`);
}
let isShuttingDown = false;

async function emergencyStop(reason: string, error?: any) {
    if (isShuttingDown) return; 
    isShuttingDown = true;

    console.log(`\n\n🛑 PARADA DETECTADA: ${reason}`);
    if (error) console.error("   Detalhe do Erro:", error);

    console.log("🧹 Iniciando  cancelamento em massa...");

    const cancelPromises: Promise<void>[] = [];
    
    botsByKalshiTicker.forEach((bot) => {
        const s = bot.getState();
        if (s.activeOrderId) {
            console.log(`   -> Cancelando ordem em ${bot.ticker}...`);
            cancelPromises.push(bot.cancelOrder());
        }
    });

    if (cancelPromises.length === 0) {
        console.log("✅ Nenhuma ordem aberta para cancelar.");
        process.exit(0);
    }

    try {
        await Promise.race([
            Promise.all(cancelPromises),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        console.log("✅ Todas as ordens foram canceladas com sucesso.");
    } catch (e) {
        console.error("⚠️ Alguns cancelamentos podem ter falhado (timeout ou erro de rede).");
    }

    console.log("Encerrando processo.");
    process.exit(1);
}

process.on('SIGINT', () => emergencyStop('SIGINT (Usuário cancelou)'));

process.on('SIGTERM', () => emergencyStop('SIGTERM (Sistema encerrou)'));

process.on('uncaughtException', (err) => emergencyStop('CRASH (Erro no código)', err));

process.on('unhandledRejection', (reason) => emergencyStop('CRASH (Promise Rejection)', reason));

main().catch(console.error);