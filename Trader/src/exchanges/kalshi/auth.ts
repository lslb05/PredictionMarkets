import { ExchangeCredentials } from '../../types'; // Ajuste o caminho conforme sua estrutura
import * as crypto from 'crypto';

export class KalshiAuth {
    private credentials: ExchangeCredentials;

    constructor(credentials: ExchangeCredentials) {
        this.credentials = credentials;
        this.validateCredentials();
    }

    private validateCredentials() {
        if (!this.credentials.apiKey) {
            throw new Error('Kalshi requires an apiKey (Key ID) for authentication');
        }
        // No Kalshi, a privateKey geralmente vem como string (PEM) ou arquivo lido antes
        if (!this.credentials.privateKey) {
            throw new Error('Kalshi requires a privateKey (RSA Private Key) for authentication');
        }
    }

    public getHeaders(method: string, path: string): Record<string, string> {
        const timestamp = Date.now().toString();
        const signature = this.signRequest(timestamp, method, path);

        return {
            'KALSHI-ACCESS-KEY': this.credentials.apiKey!,
            'KALSHI-ACCESS-TIMESTAMP': timestamp,
            'KALSHI-ACCESS-SIGNATURE': signature,
            'Content-Type': 'application/json'
        };
    }

    private signRequest(timestamp: string, method: string, path: string): string {
        // O path deve incluir query params se houver, mas para assinatura básica é o path relativo
        const payload = `${timestamp}${method}${path}`;
        
        try {
            const signer = crypto.createSign('SHA256');
            signer.update(payload);
            
            const privateKey = this.credentials.privateKey!;

            const signature = signer.sign({
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
            }, 'base64');

            return signature;
        } catch (error: any) {
            throw new Error(`Failed to sign Kalshi request: ${error.message}`);
        }
    }
}