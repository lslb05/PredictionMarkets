import { Wallet } from 'ethers';
import { ApiKeyCreds } from '@polymarket/clob-client';

export interface PolyAuthConfig {
    privateKey: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;
    funderAddress?: string;
}
export class PolymarketAuth {
    private wallet: Wallet;
    private creds: ApiKeyCreds;
    private funder: string;

    constructor(config: PolyAuthConfig) {
        if (!config.privateKey) throw new Error("Private Key is required");
        
        this.wallet = new Wallet(config.privateKey);
        
        this.creds = {
            key: config.apiKey || '',
            secret: config.apiSecret || '',
            passphrase: config.passphrase || ''
        };
        this.funder = config.funderAddress || this.wallet.address;
    }

    public getSigner(): Wallet {
        const signer = this.wallet;
        if (!(signer as any)._signTypedData && (signer as any).signTypedData) {
            (signer as any)._signTypedData = async (domain: any, types: any, value: any) => {
                if (types.EIP712Domain) delete types.EIP712Domain;
                return (signer as any).signTypedData(domain, types, value);
            };
        }
        return signer;
    }

    public getCreds(): ApiKeyCreds { return this.creds; }
    

    public getFunderAddress(): string { return this.funder; } 
    
    public getAddress(): string { return this.wallet.address; }
}