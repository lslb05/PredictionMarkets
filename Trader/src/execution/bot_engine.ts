import { KalshiApi } from '../exchanges/kalshi/api';
import { MarketState } from '../exchanges/polymarket/stream';
import { PolymarketExecutor } from '../exchanges/polymarket/executor';
import { FillEvent } from './kalshi_fill_monitor';

export enum BotStatus {
    IDLE = '🔵 IDLE',        
    PLACING = '🟡 PLACING',  
    WORKING = '🟢 WORKING',  
    HEDGING = '🟣 HEDGING',  
    CANCELLING = '🟠 CANCELLING', // <--- NOVO STATUS
    STOPPED = '⚫ STOPPED'   
}

export interface BotState {
    status: BotStatus;
    currentSpread: number;
    minProfit: number;
    isConditionMet: boolean;
    activeOrderId: string | null;
    activeOrderPrice: number;
    activeOrderSide: 'yes' | 'no' | null;
    activeOrderSize: number;
    targetSide: 'yes' | 'no' | null;
    hedgeTokenId: string | null;
    pendingHedgeQty: number; 
}

export class BotEngine {
    public readonly kApi: KalshiApi;
    private polyExecutor?: PolymarketExecutor;
    
    public readonly ticker: string;
    public readonly polyYesId: string;
    public readonly polyNoId: string;
    public readonly minProfit: number;

    // Estado Interno
    private status: BotStatus = BotStatus.IDLE;
    private activeOrderId: string | null = null;
    private activeOrderPrice: number = 0;
    private activeOrderSide: 'yes' | 'no' | null = null;
    private activeOrderSize: number = 0;
    
    private currentSpread: number = 0;

    // Gestão de Risco
    private pendingHedgeQty: number = 0;
    private HEDGE_THRESHOLD = 5; 
    private isHedgingNow: boolean = false;

    // Controle de Mira
    private targetSide: 'yes' | 'no' | null = null;
    private hedgeTokenId: string | null = null;

    constructor(
        kApi: KalshiApi, 
        ticker: string, 
        polyYesId: string, 
        polyNoId: string, 
        minProfit: number,
        polyExecutor?: PolymarketExecutor
    ) {
        this.kApi = kApi;
        this.ticker = ticker;
        this.polyYesId = polyYesId;
        this.polyNoId = polyNoId;
        this.minProfit = minProfit;
        this.polyExecutor = polyExecutor;
    }

    // =========================================================================
    // 1. ON FILL
    // =========================================================================
    public async onFill(fill: FillEvent) {
        if (fill.ticker !== this.ticker) return;
        console.log(`💧 FILL DETECTADO! ${fill.count} un.`);
        this.pendingHedgeQty += fill.count;
        this.checkAndTriggerHedge();
    }

    // =========================================================================
    // 2. ON TICK (Lógica: Seguidor Passivo)
    // =========================================================================
    public async onTick(kState: MarketState, pYesState: MarketState, pNoState: MarketState) {
        if (this.status === BotStatus.STOPPED || this.status === BotStatus.CANCELLING) return;

        // --- A) DADOS DO MERCADO ---
        const kBidYes = kState.bids[0]?.price || 0;     
        const pAskNo  = pNoState.asks[0]?.price || 1.00; 
        const spreadYesBase = Number(((1.00 - (kBidYes + pAskNo)) * 100).toFixed(2)); 

        const kBidNo = kState.asks[0]?.price || 0;      
        const pAskYes = pYesState.asks[0]?.price || 1.00; 
        const spreadNoBase = Number(((1.00 - (kBidNo + pAskYes)) * 100).toFixed(2));

        // --- B) DECISÃO DE LADO ---
        let marketFloor = 0; // O Bid que vamos copiar
        let polyCost = 0;

        if (spreadYesBase > spreadNoBase) {
            this.targetSide = 'yes';
            this.hedgeTokenId = this.polyNoId;
            marketFloor = kBidYes;
            polyCost = pAskNo;
        } else {
            this.targetSide = 'no';
            this.hedgeTokenId = this.polyYesId;
            marketFloor = kBidNo;
            polyCost = pAskYes;
        }

        // --- C) LÓGICA DE PREÇO (SIMPLIFICADA) ---
        // Alvo: Exatamente o Bid do Mercado (Empatar)
        const floorCents = Math.round(marketFloor * 100);
        
        // Calcula lucro se entrarmos nesse preço
        const passiveSpread = (1.00 - ((floorCents / 100) + polyCost)) * 100;
        
        // Atualiza visual
        this.currentSpread = Number(passiveSpread.toFixed(2));

        let finalTargetPrice = 0;

        // CONDIÇÃO ÚNICA: O Bid atual dá lucro?
        // Se sim, copiamos. Se não, saímos.
        if (passiveSpread >= this.minProfit && floorCents > 0) {
            finalTargetPrice = floorCents;
        } else {
            finalTargetPrice = 0; // Spread ruim
        }

        // --- D) EXECUÇÃO ---
        const isTradeable = finalTargetPrice > 0;

        // Atualiza Status Visual
        if (!this.isHedgingNow) {
            this.status = this.isHedgingNow ? BotStatus.HEDGING : 
                          (this.activeOrderId ? BotStatus.WORKING : BotStatus.IDLE);
        }

        if (isTradeable) {
            // 1. Sem ordem -> Cria
            if (!this.activeOrderId && this.status !== BotStatus.PLACING) {
                await this.placeOrder(finalTargetPrice);
            }
            // 2. Com ordem -> Preço mudou? Move.
            else if (this.activeOrderId && this.activeOrderPrice !== finalTargetPrice) {
                await this.cancelOrder(); 
            }
            // 3. Com ordem e preço igual -> NÃO FAZ NADA (Mantém a posição na fila)
        } else {
            // Se não é negociável e tenho ordem aberta -> Cancela
            if (this.activeOrderId) {
                await this.cancelOrder();
            }
        }
        
        this.checkAndTriggerHedge();
    }

    // =========================================================================
    // 3. HEDGE SYSTEM
    // =========================================================================
    private checkAndTriggerHedge() {
        if (
            this.pendingHedgeQty >= this.HEDGE_THRESHOLD && 
            !this.isHedgingNow && 
            this.polyExecutor &&
            this.hedgeTokenId
        ) {
            this.executeHedge(this.hedgeTokenId, this.pendingHedgeQty);
        }
    }

    private async executeHedge(tokenId: string, qtyTotal: number) {
        this.isHedgingNow = true; 
        this.status = BotStatus.HEDGING;

        const qtyToHedge = Math.floor(qtyTotal); 
        console.log(`🦅 [HEDGE] Disparando compra de ${qtyToHedge} un...`);

        try {
            const success = await this.polyExecutor?.buyHedge(tokenId, qtyToHedge);

            if (success) {
                console.log(`✅ [HEDGE] Sucesso!`);
                this.pendingHedgeQty -= qtyToHedge; 
                this.isHedgingNow = false;
            } else {
                throw new Error("Polymarket recusou (FOK).");
            }
        } catch (e) {
            console.error(`❌ [HEDGE] FALHA CRÍTICA!`);
            await this.cancelOrder();
            this.status = BotStatus.STOPPED;
        }
    }

    // =========================================================================
    // 4. CRUD ORDENS
    // =========================================================================
    private async placeOrder(price: number) {
        if (this.status === BotStatus.PLACING) return;
        this.status = BotStatus.PLACING;
        
        try {
            // 👇 LOTE FIXO DE 5 (Pode aumentar depois)
            const size = 5; 
            const side = this.targetSide || 'yes';
            
            const res = await this.kApi.createOrder({
                ticker: this.ticker,
                count: size,
                side: side,
                price: price,
                action: 'buy',
                type: 'limit'
            });

            if (res && res.order_id) {
                this.activeOrderId = res.order_id;
                this.activeOrderPrice = price;
                this.activeOrderSide = side;
                this.activeOrderSize = size;
                this.status = BotStatus.WORKING;
                console.log(`✨ [${side.toUpperCase()}] Ordem criada @ ${price}¢`);
            } else {
                this.status = BotStatus.IDLE; 
            }
        } catch (e) {
            console.error("Erro Place:", e);
            this.status = BotStatus.IDLE;
        }
    }

    public async cancelOrder() {
        if (!this.activeOrderId) return;
        
        // 1. Trava o robô para ninguém mexer
        this.status = BotStatus.CANCELLING;
        const idToCancel = this.activeOrderId;

        try {
            // 2. Tenta cancelar na Kalshi
            await this.kApi.cancelOrder(idToCancel);
            
            // 3. SUCESSO: Agora sim limpamos da memória
            console.log(`🗑️ Ordem ${idToCancel} cancelada com sucesso.`);
            this.activeOrderId = null; 
            this.activeOrderPrice = 0;
            this.activeOrderSize = 0;
            this.status = BotStatus.IDLE;

        } catch (e: any) {
            // 4. TRATAMENTO DE ERRO INTELIGENTE
            const errorMsg = e.message || JSON.stringify(e);

            // Cenário A: A ordem já sumiu (foi executada ou já cancelada)
            // A API geralmente retorna 404 ou "not found" ou "invalid order id"
            if (errorMsg.includes('not found') || errorMsg.includes('invalid') || errorMsg.includes('closed')) {
                console.warn(`⚠️ Ordem ${idToCancel} não existe mais. Limpando memória.`);
                this.activeOrderId = null;
                this.activeOrderPrice = 0;
                this.status = BotStatus.IDLE;
            } 
            // Cenário B: Erro de Rede / Timeout / Server Busy
            else {
                console.error(`❌ Falha ao cancelar (Rede/API). Vamos tentar de novo no próximo tick.`);
                // NÃO limpamos o activeOrderId!
                // Voltamos para WORKING para que o onTick perceba que o preço está errado 
                // e chame cancelOrder() novamente.
                this.status = BotStatus.WORKING;
            }
        }
    }

    public getState(): BotState {
        const visualStatus = this.status === BotStatus.STOPPED ? BotStatus.STOPPED :
                             (this.isHedgingNow ? BotStatus.HEDGING : this.status);

        return {
            status: visualStatus,
            currentSpread: this.currentSpread, 
            minProfit: this.minProfit,
            isConditionMet: true,
            activeOrderId: this.activeOrderId,
            activeOrderPrice: this.activeOrderPrice,
            activeOrderSide: this.activeOrderSide,
            activeOrderSize: this.activeOrderSize,
            targetSide: this.targetSide,
            hedgeTokenId: this.hedgeTokenId,
            pendingHedgeQty: this.pendingHedgeQty
        };
    }
}