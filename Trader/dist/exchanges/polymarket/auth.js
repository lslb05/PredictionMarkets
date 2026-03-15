"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketAuth = void 0;
const clob_client_1 = require("@polymarket/clob-client");
const ethers_1 = require("ethers");
const POLYMARKET_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = 137;
class PolymarketAuth {
    constructor(credentials) {
        this.credentials = credentials;
        if (!credentials.privateKey) {
            throw new Error('Polymarket requires a privateKey for authentication');
        }
        this.signer = new ethers_1.Wallet(credentials.privateKey);
    }
    async getApiCredentials() {
        if (this.apiCreds)
            return this.apiCreds;
        if (this.credentials.apiKey && this.credentials.apiSecret && this.credentials.passphrase) {
            this.apiCreds = {
                key: this.credentials.apiKey,
                secret: this.credentials.apiSecret,
                passphrase: this.credentials.passphrase,
            };
            return this.apiCreds;
        }
        const l1Client = new clob_client_1.ClobClient(POLYMARKET_HOST, POLYGON_CHAIN_ID, 
        // O cast 'as any' resolve o conflito de tipos entre Ethers v5 e v6
        this.signer);
        let creds;
        try {
            creds = await l1Client.deriveApiKey();
        }
        catch (deriveError) {
            try {
                creds = await l1Client.createApiKey();
            }
            catch (createError) {
                console.error('Failed to both derive and create API key:', createError?.message || createError);
                throw new Error('Authentication failed: Could not create or derive API key.');
            }
        }
        if (!creds)
            throw new Error('Authentication failed: Credentials are empty.');
        this.apiCreds = creds;
        return creds;
    }
    async getClobClient() {
        if (this.clobClient)
            return this.clobClient;
        const apiCreds = await this.getApiCredentials();
        const signatureType = this.credentials.signatureType ?? 0;
        const funderAddress = this.credentials.funderAddress ?? this.signer.address;
        this.clobClient = new clob_client_1.ClobClient(POLYMARKET_HOST, POLYGON_CHAIN_ID, 
        // O cast 'as any' resolve o conflito de tipos entre Ethers v5 e v6
        this.signer, apiCreds, signatureType, funderAddress);
        return this.clobClient;
    }
    getAddress() {
        return this.signer.address;
    }
    reset() {
        this.apiCreds = undefined;
        this.clobClient = undefined;
    }
}
exports.PolymarketAuth = PolymarketAuth;
