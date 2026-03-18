import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';

// Imports do seu projeto
import { BotEngine, BotStatus } from '../execution/bot_engine';
import { PolymarketAuth } from '../exchanges/polymarket/auth';
import { PolymarketExecutor } from '../exchanges/polymarket/executor';
import { FillEvent } from '../execution/kalshi_fill_monitor';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const color = (txt: string, type: 'green' | 'red' | 'yellow' | 'cyan' | 'reset') => {
    const codes = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
    return `${codes[type]}${txt}${codes.reset}`;
};

// =============================================================================
// ⚙️ CONFIGURAÇÃO DE TESTE
// =============================================================================
const CONFIG = {
    KALSHI_TICKER: 'TEST-TICKER',
    POLY_YES_ID: '109876868437950584369987384406356259939519193117253465815665152916226511121427',
    POLY_NO_ID:  '38310927461258927563020508025396887688249787380193911540547071417200646834355',
    MIN_PROFIT: -999,
};

// --- MOCK DA API KALSHI (FALSA) ---
const MockKalshiApi: any = {
    createOrder: async () => ({ order_id: "mock-order-123" }),
    cancelOrder: async () => { 
        return true; 
    }
};

async function main() {
    console.clear();
    console.log("🧪 TESTE MANUAL DE HEDGE: MIRANDO NO 'YES'");
    console.log(`----------------------------------------------------------------`);
    console.log(`🎯 ID ALVO (YES):    ${color(CONFIG.POLY_YES_ID.slice(0, 20) + '...', 'green')}`);
    console.log(`----------------------------------------------------------------`);

    // 1. CONEXÃO COM POLYMARKET REAL
    let polyExecutor: PolymarketExecutor | undefined;
    try {
        const polyAuth = new PolymarketAuth({
            privateKey: process.env.POLYMARKET_PK || '',
            apiKey: process.env.POLYMARKET_API_KEY,
            apiSecret: process.env.POLYMARKET_API_SECRET,
            passphrase: process.env.POLYMARKET_API_PASSPHRASE,
            funderAddress: process.env.POLYMARKET_FUNDER
        });
        polyExecutor = new PolymarketExecutor(polyAuth);
        console.log("🦅 Executor Polymarket: CONECTADO (⚠️ VAI GASTAR DINHEIRO REAL!)");
    } catch (e: any) {
        console.error("❌ Erro Auth Poly:", e.message);
        process.exit(1);
    }

    // 2. INICIALIZA O BOT
    const bot = new BotEngine(
        MockKalshiApi, 
        CONFIG.KALSHI_TICKER,
        CONFIG.POLY_YES_ID,
        CONFIG.POLY_NO_ID,
        CONFIG.MIN_PROFIT,
        polyExecutor
    );

    // 3. 🎯 FORÇAR A MIRA NO "YES" (A MÁGICA ACONTECE AQUI)
    // Para o robô querer comprar POLY YES, ele precisa achar que operar KALSHI NO é lucrativo.
    // Simulação:
    // - Kalshi NO (Ask no adapter): Pagamos $0.80 (Bem alto, ótimo pra vender/shortar ou comprar NO)
    // - Poly YES (Ask): Custa $0.10 (Muito barato)
    // - Lucro: 1.00 - (0.80 + 0.10) = +$0.10. (Positivo = Robô aceita)
    
    bot.onTick(
        // Kalshi State (Onde 'asks' simula o preço do contrato NO)
        { 
            bids: [], 
            asks: [{price: 0.80, size: 5000}], 
            spread: 0, timestamp: 0 
        }, 
        // Poly YES State (Barato para fechar a conta)
        { bids: [], asks: [{price: 0.10, size: 5000}], spread: 0, timestamp: 0 }, 
        // Poly NO State (Irrelevante, deixamos vazio)
        { bids: [], asks: [], spread: 0, timestamp: 0 }  
    );
    
    // 4. VALIDAÇÃO DE SEGURANÇA
    const state = bot.getState();
    if (state.hedgeTokenId === CONFIG.POLY_YES_ID) {
        console.log(`✅ Mira Travada: ${color("POLYMARKET YES", 'green')}`);
        console.log(`   ID Atual do Bot: ${state.hedgeTokenId}`);
    } else {
        console.error(`❌ ERRO CRÍTICO: O robô mirou errado!`);
        console.error(`   Ele está mirando em: ${state.hedgeTokenId}`);
        console.error(`   Esperado (YES):      ${CONFIG.POLY_YES_ID}`);
        process.exit(1);
    }

    // 5. LOOP MANUAL
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n🎮 MODO MANUAL PRONTO");
    console.log("   Digite a quantidade simulada e aperte ENTER.");
    console.log("   Digite 'exit' para sair.");

    const prompt = () => {
        const s = bot.getState();
        const filled = Math.min(s.pendingHedgeQty, 5);
        const bar = '█'.repeat(filled) + '░'.repeat(5 - filled);
        let barColor: any = s.pendingHedgeQty >= 5 ? 'red' : 'yellow';

        process.stdout.write(`\n🪣  Balde [${color(bar, barColor)}] ${s.pendingHedgeQty}/5 | Qtd Fill (Kalshi) > `);
    };

    prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (input === 'exit') process.exit(0);

        const qty = parseInt(input);
        if (isNaN(qty)) { prompt(); return; }

        // Simula Fill na Kalshi (Lado NO, para casar com a estratégia)
        const fakeFill: FillEvent = {
            ticker: CONFIG.KALSHI_TICKER, 
            count: qty,
            price: 80, 
            side: 'no', // O robô "comprou" NO na Kalshi
            isTaker: true,
            orderId: 'manual-test-order',
            tradeId: `manual-fill-${Date.now()}`, 
            timestamp: Date.now()
        };

        console.log(`\n📥 Injetando Fill de ${qty}...`);
        
        // Dispara o evento no Bot
        await bot.onFill(fakeFill);

        // Verifica o resultado
        const s = bot.getState();
        if (s.status === BotStatus.HEDGING) {
            console.log(color("\n🚀 DISPARO REALIZADO: Ordem enviada ao Polymarket!", 'green'));
        } else if (s.status === BotStatus.STOPPED) {
            console.log(color("\n🛑 ROBÔ PAROU (Erro ou Limite de Segurança)", 'red'));
        }

        prompt();
    });
}

main();