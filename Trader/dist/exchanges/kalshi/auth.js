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
exports.KalshiAuth = void 0;
const crypto = __importStar(require("crypto"));
class KalshiAuth {
    constructor(credentials) {
        this.credentials = credentials;
        this.validateCredentials();
    }
    validateCredentials() {
        if (!this.credentials.apiKey) {
            throw new Error('Kalshi requires an apiKey (Key ID) for authentication');
        }
        // No Kalshi, a privateKey geralmente vem como string (PEM) ou arquivo lido antes
        if (!this.credentials.privateKey) {
            throw new Error('Kalshi requires a privateKey (RSA Private Key) for authentication');
        }
    }
    getHeaders(method, path) {
        const timestamp = Date.now().toString();
        const signature = this.signRequest(timestamp, method, path);
        return {
            'KALSHI-ACCESS-KEY': this.credentials.apiKey,
            'KALSHI-ACCESS-TIMESTAMP': timestamp,
            'KALSHI-ACCESS-SIGNATURE': signature,
            'Content-Type': 'application/json'
        };
    }
    signRequest(timestamp, method, path) {
        // O path deve incluir query params se houver, mas para assinatura básica é o path relativo
        const payload = `${timestamp}${method}${path}`;
        try {
            const signer = crypto.createSign('SHA256');
            signer.update(payload);
            const privateKey = this.credentials.privateKey;
            const signature = signer.sign({
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
            }, 'base64');
            return signature;
        }
        catch (error) {
            throw new Error(`Failed to sign Kalshi request: ${error.message}`);
        }
    }
}
exports.KalshiAuth = KalshiAuth;
