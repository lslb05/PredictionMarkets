"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("../stream");
// ID do Token (Pode ser YES ou NO)
const TOKEN_ID = "30630994248667897740988010928640156931882346081873066002335460180076741328029";
// CONFIGURAÇÃO MANUAL: Mude para false se esse ID for do token NO
const IS_YES = true;
// Função que o robô vai rodar toda vez que o preço mudar
function onPriceUpdate(market) {
    // Limpa tela
    process.stdout.write('\x1Bc');
    console.log("========================================");
    console.log("🤖 MONITOR VIA MÓDULO (CLEAN DATA)");
    console.log("========================================");
    console.log(`BID (Vender YES):  $${market.yesBid.toFixed(3)}`);
    console.log(`ASK (Comprar YES): $${market.yesAsk.toFixed(3)}`);
    console.log("----------------------------------------");
    const spreadCents = market.spread * 100;
    console.log(`📉 Spread: ${spreadCents.toFixed(1)}¢`);
    if (spreadCents < 0)
        console.log("⚠️  CROSS MARKET!");
    console.log(`🕒 Ts: ${market.timestamp}`);
}
// Inicialização
const stream = new stream_1.PolymarketStream(TOKEN_ID, IS_YES);
// Inicia passando a função de callback
stream.connect(onPriceUpdate);
// Mantém rodando...
