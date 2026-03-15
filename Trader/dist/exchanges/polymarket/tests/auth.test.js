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
const auth_1 = require("../auth");
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../../');
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });
async function runAuthTest() {
    try {
        console.log("🔐 Iniciando Teste de Autenticação Polymarket...");
        const creds = {
            privateKey: process.env.POLYMARKET_PK || '',
            apiKey: process.env.POLYMARKET_API_KEY,
            apiSecret: process.env.POLYMARKET_API_SECRET,
            passphrase: process.env.POLYMARKET_API_PASSPHRASE,
            funderAddress: process.env.POLYMARKET_FUNDER
        };
        if (!creds.privateKey)
            throw new Error("❌ POLYMARKET_PK faltando no .env");
        const auth = new auth_1.PolymarketAuth(creds);
        console.log(`👤 Signer (PK):   ${auth.getAddress()}`);
        if (creds.funderAddress)
            console.log(`🏦 Funder (Proxy): ${creds.funderAddress}`);
        console.log("🔄 Autenticando na API L2 (CLOB)...");
        const client = await auth.getClobClient();
        // Teste 1: Validação de API Keys
        const apiKeys = await auth.getApiCredentials();
        console.log(`✅ API Key Lida/Derivada: ${apiKeys.key.slice(0, 10)}...`);
        // Teste 2: Buscar Ordens Abertas (Endpoint Privado)
        // Se este método funcionar, sua autenticação está 100%
        console.log("📂 Buscando ordens abertas...");
        try {
            // CORREÇÃO: O método correto é getOpenOrders()
            const orders = await client.getOpenOrders();
            console.log("------------------------------------------------");
            console.log(`✅ SUCESSO! Acesso confirmado.`);
            console.log(`📋 Ordens abertas: ${orders.length}`);
            if (orders.length > 0) {
                console.log("Última ordem:", JSON.stringify(orders[0], null, 2));
            }
        }
        catch (err) {
            console.log("⚠️  Aviso: Não foi possível ler ordens (Pode ser normal se a conta for virgem).");
            console.log("Erro:", err.message);
        }
        console.log("------------------------------------------------");
    }
    catch (error) {
        console.error("\n❌ FALHA NA AUTENTICAÇÃO:");
        console.error(error.message);
        if (error.response) {
            console.error("Detalhes API:", JSON.stringify(error.response.data));
        }
    }
}
runAuthTest();
