import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { PolymarketAuth } from './auth';

export class PolymarketExecutor {
    private client: ClobClient;
    private auth: PolymarketAuth;

    constructor(auth: PolymarketAuth) {
        this.auth = auth;
        
        this.client = new ClobClient(
            'https://clob.polymarket.com',
            137, 
            auth.getSigner() as any, 
            auth.getCreds(),
            1, 
            auth.getFunderAddress()
        );
    }
    public async buyHedge(tokenId: string, quantity: number): Promise<boolean> {
        try {
            console.log(`🦅 [POLY] Iniciando Hedge (Proxy Mode)...`);
            console.log(`   Token: ${tokenId.slice(0, 10)}...`);
            console.log(`   Qtd: ${quantity}`);
            console.log(`   Pagador: ${this.auth.getFunderAddress()}`);

            const MAX_PRICE = 0.99;

            const orderPayload = {
                tokenID: tokenId,
                price: MAX_PRICE,
                side: Side.BUY,
                size: quantity,
                orderType: OrderType.FOK
            } as any;
            const response = await this.client.createAndPostOrder(orderPayload);

            console.log(`✅ [POLY] Resposta do Servidor:`, response);
            
            if (response && (response as any).success) {
                 return true;
            } else {
                 if ((response as any).errorMsg) console.error(`❌ Erro API: ${(response as any).errorMsg}`);
                 return false;
            }

        } catch (e: any) {
            const msg = e.message || JSON.stringify(e);
            console.error(`❌ [POLY] Erro Crítico: ${msg}`);
            return false;
        }
    }
}