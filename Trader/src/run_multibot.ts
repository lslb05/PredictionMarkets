import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Imports Kalshi
import { KalshiAuth } from './exchanges/kalshi/auth';
import { KalshiApi } from './exchanges/kalshi/api';
import { KalshiStream } from './exchanges/kalshi/stream_ws';
import { KalshiBookProcessor } from './exchanges/kalshi/book_processor';
import { KalshiFillMonitor } from './execution/kalshi_fill_monitor';

// Bot Imports
import { BotEngine } from './execution/bot_engine';
import { MARKETS } from './markets_config';

// Polymarket Imports
import { PolymarketAuth } from './exchanges/polymarket/auth'; 
import { PolymarketStream, MarketState } from './exchanges/polymarket/stream_multi'; // Verifique se o nome do arquivo está certo
import { PolymarketExecutor } from './exchanges/polymarket/executor';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

//const CONFIG = {
  //  KEY_FILE: 'daviglib.txt',
    //USE_REAL_HEDGE: true
//};

const CONFIG = {
    KEY_FILE: process.env.KALSHI_API_KEYFILE ,
    USE_REAL_HEDGE: true
};

// --- MAPAS DE ROTEAMENTO ---
const botsByKalshiTicker = new Map<string, BotEngine>();
const botsByPolyToken = new Map<string, BotEngine>();

// --- CACHE DE ESTADO DE MERCADO ---
const marketStateCache = new Map<string, MarketState>();

async function main() {
    console.log(`🚀 INICIANDO ORQUESTRADOR MULTI-MERCADO (${MARKETS.length} ativos)...`);

    // 1. AUTH KALSHI
    const keyPath = path.join(__dirname, '../', CONFIG.KEY_FILE!);
    const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
    const kAuth = new KalshiAuth({ apiKey: process.env.KALSHI_API_KEY!, privateKey });
    const kApi = new KalshiApi(kAuth);

    // 2. AUTH POLYMARKET
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
            console.log("🦅 Polymarket Executor: CONECTADO (Compartilhado)");
        } catch (e: any) {
            console.error("❌ Erro Auth Poly:", e.message);
        }
    }

    // 3. INICIALIZAR MOTORES (Fábrica de Robôs)
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

        // Registra nos mapas
        botsByKalshiTicker.set(conf.kalshiTicker, bot);
        botsByPolyToken.set(conf.polyYesId, bot);
        botsByPolyToken.set(conf.polyNoId, bot);

        allPolyIds.push(conf.polyYesId, conf.polyNoId);
        allKalshiTickers.push(conf.kalshiTicker);
    });

    // 4. CONEXÃO WEBSOCKET KALSHI (Única)
    const kStream = new KalshiStream(kAuth);
    
    // Listas para o Roteador
    const processors: KalshiBookProcessor[] = [];
    const monitors: KalshiFillMonitor[] = [];

    // Cria os componentes para cada mercado
    MARKETS.forEach(conf => {
        const bot = botsByKalshiTicker.get(conf.kalshiTicker);
        if(!bot) return;

        // Processor: Atualiza Book -> Cache -> Tick
        const proc = new KalshiBookProcessor(kStream, conf.kalshiTicker);
        proc.setCallback((state) => {
            marketStateCache.set(conf.kalshiTicker, state);
            tryTickBot(bot);
        });
        processors.push(proc);

        // Monitor: Recebe Fill -> Avisa Bot
        const mon = new KalshiFillMonitor(kStream, conf.kalshiTicker);
        mon.setCallback((fill) => bot.onFill(fill));
        monitors.push(mon);
    });

    // ROTEADOR DE MENSAGENS KALSHI
    kStream.connect((msg: any) => {
        // Distribui a mensagem para todos. 
        // Eles têm filtro interno ("if msg.ticker != this.ticker return"), então é seguro.
        processors.forEach(p => p.processMessage(msg));
        monitors.forEach(m => m.processMessage(msg));
    });

    setTimeout(() => {
        console.log("📨 Inscrevendo canais Kalshi (BATCH)...");
        
        // ❌ COMO ERA ANTES (Loop que causava erro):
        // allKalshiTickers.forEach(t => kStream.subscribe(t));

        // ✅ COMO TEM QUE SER (Uma chamada única):
        if (allKalshiTickers.length > 0) {
            kStream.subscribe(allKalshiTickers);
        }
        
    }, 2500);


    // 5. CONEXÃO WEBSOCKET POLYMARKET (Única)
    // Passamos a lista completa de IDs
    const pStream = new PolymarketStream(allPolyIds);
    
    // 
    pStream.connect((tokenId: string, state: MarketState) => {
        // 1. Atualiza o cache global com o novo preço deste token específico
        marketStateCache.set(tokenId, state);

        // 2. Descobre qual robô é dono desse token
        const bot = botsByPolyToken.get(tokenId);
        
        // 3. Roda a lógica desse robô
        if(bot) tryTickBot(bot);
    });

    // 6. RENDER LOOP (Tabela Resumo)
    setInterval(() => renderSummary(), 1000);
}

// FUNÇÃO HELPER: Tenta rodar o ciclo do bot se tivermos os 3 estados necessários
function tryTickBot(bot: BotEngine) {
    const kState = marketStateCache.get(bot.ticker);
    const pYesState = marketStateCache.get(bot.polyYesId);
    const pNoState = marketStateCache.get(bot.polyNoId);

    // Só roda se tivermos dados de todos os lados
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

        // --- 2. LINHA DE RESUMO ---
        let statusColor = '\x1b[37m'; 
        if (s.status === '🟢 WORKING') statusColor = '\x1b[32m';
        if (s.status === '🟣 HEDGING') statusColor = '\x1b[35m';
        if (!s.isConditionMet) statusColor = '\x1b[90m'; 

        const statusStr = s.status.split(' ')[1].padEnd(9);
        const spreadStr = s.currentSpread.toFixed(2).padStart(6);
        const metaStr = s.minProfit.toFixed(1).padStart(4);
        const hedgeStr = `${s.pendingHedgeQty}/5`.padStart(5);
        
        // --- MUDANÇA 1: Casas Decimais no Topo ---
        // Kalshi (Inteiro)
        const topK = kBookSide[0] ? (kBookSide[0].price * 100).toFixed(0) + '¢' : '--';
        // Polymarket (1 Decimal)
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

        // --- 3. MINI ORDER BOOK ---
        if (kBookSide.length > 0 || pBookSide.length > 0) {
            console.log(`|   └─ 📊 BOOK:     \x1b[90mKALSHI BID (Qtd @ Preço)     ||      POLY ASK (Preço @ Qtd)\x1b[0m`);
            
            for (let i = 0; i < 3; i++) {
                const kItem = kBookSide[i];
                const pItem = pBookSide[i];

                // Kalshi (Inteiro)
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

                // --- MUDANÇA 2: Casas Decimais no Loop do Poly ---
                let pText = "--           ";
                if (pItem) {
                    // toFixed(1) garante ex: "12.5" ou "12.0"
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
// =============================================================================
// 🛡️ SISTEMA DE SEGURANÇA (KILL SWITCH)
// =============================================================================
let isShuttingDown = false;

async function emergencyStop(reason: string, error?: any) {
    if (isShuttingDown) return; // Evita rodar duas vezes
    isShuttingDown = true;

    console.log(`\n\n🛑 PARADA DETECTADA: ${reason}`);
    if (error) console.error("   Detalhe do Erro:", error);

    console.log("🧹 Iniciando protocolo de cancelamento em massa...");

    // Coleta todas as promessas de cancelamento
    const cancelPromises: Promise<void>[] = [];
    
    botsByKalshiTicker.forEach((bot) => {
        // Só tenta cancelar se tiver ordem ativa
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
        // Tenta cancelar tudo em paralelo. Se demorar mais que 3s, força a saída.
        await Promise.race([
            Promise.all(cancelPromises),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        console.log("✅ Todas as ordens foram canceladas com sucesso.");
    } catch (e) {
        console.error("⚠️ Alguns cancelamentos podem ter falhado (timeout ou erro de rede).");
    }

    console.log("👋 Encerrando processo. Até logo!");
    process.exit(1);
}

// 1. Captura Ctrl+C (Manual)
process.on('SIGINT', () => emergencyStop('SIGINT (Usuário cancelou)'));

// 2. Captura Kill Command (Docker/System)
process.on('SIGTERM', () => emergencyStop('SIGTERM (Sistema encerrou)'));

// 3. Captura Erros de Código (Bugs não tratados)
process.on('uncaughtException', (err) => emergencyStop('CRASH (Erro no código)', err));

// 4. Captura Erros de Promessas (Async falhou)
process.on('unhandledRejection', (reason) => emergencyStop('CRASH (Promise Rejection)', reason));

main().catch(console.error);