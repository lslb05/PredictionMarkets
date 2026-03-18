import { KalshiApi } from '../exchanges/kalshi/api';
import { MarketState } from '../exchanges/polymarket/stream';
import { PolymarketExecutor } from '../exchanges/polymarket/executor';
import { FillEvent } from './kalshi_fill_monitor';

export enum BotStatus {
    IDLE = '🔵 IDLE',
    PLACING = '🟡 PLACING',
    WORKING = '🟢 WORKING',
    HEDGING = '🟣 HEDGING',
    CANCELLING = '🟠 CANCELLING',
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

    private status: BotStatus = BotStatus.IDLE;
    private activeOrderId: string | null = null;
    private activeOrderPrice: number = 0;
    private activeOrderSide: 'yes' | 'no' | null = null;
    private activeOrderSize: number = 0;
    
    private currentSpread: number = 0;

    private pendingHedgeQty: number = 0;
    private HEDGE_THRESHOLD = 5; 
    private isHedgingNow: boolean = false;

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

    public async onFill(fill: FillEvent) {
        if (fill.ticker !== this.ticker) return;
        console.log(`💧 FILL DETECTADO! ${fill.count} un.`);
        this.pendingHedgeQty += fill.count;
        this.checkAndTriggerHedge();
    }

    public async onTick(kState: MarketState, pYesState: MarketState, pNoState: MarketState) {
        if (this.status === BotStatus.STOPPED || this.status === BotStatus.CANCELLING) return;

        const kBidYes = kState.bids[0]?.price || 0;
        const pAskNo  = pNoState.asks[0]?.price || 1.00;
        const spreadYesBase = Number(((1.00 - (kBidYes + pAskNo)) * 100).toFixed(2));

        const kBidNo = kState.asks[0]?.price || 0;
        const pAskYes = pYesState.asks[0]?.price || 1.00;
        const spreadNoBase = Number(((1.00 - (kBidNo + pAskYes)) * 100).toFixed(2));

        let marketFloor = 0;
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

        const floorCents = Math.round(marketFloor * 100);
        
        const passiveSpread = (1.00 - ((floorCents / 100) + polyCost)) * 100;
        

        this.currentSpread = Number(passiveSpread.toFixed(2));

        let finalTargetPrice = 0;

        if (passiveSpread >= this.minProfit && floorCents > 0) {
            finalTargetPrice = floorCents;
        } else {
            finalTargetPrice = 0;
        }

        
        const isTradeable = finalTargetPrice > 0;

        
        if (!this.isHedgingNow) {
            this.status = this.isHedgingNow ? BotStatus.HEDGING :
                          (this.activeOrderId ? BotStatus.WORKING : BotStatus.IDLE);
        }

        if (isTradeable) {
            
            if (!this.activeOrderId && this.status !== BotStatus.PLACING) {
                await this.placeOrder(finalTargetPrice);
            }
            
            else if (this.activeOrderId && this.activeOrderPrice !== finalTargetPrice) {
                await this.cancelOrder(); 
            }
            
        } else {
            
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
        
        this.status = BotStatus.CANCELLING;
        const idToCancel = this.activeOrderId;

        try {
            await this.kApi.cancelOrder(idToCancel);
            
            console.log(`🗑️ Ordem ${idToCancel} cancelada com sucesso.`);
            this.activeOrderId = null;
            this.activeOrderPrice = 0;
            this.activeOrderSize = 0;
            this.status = BotStatus.IDLE;

        } catch (e: any) {
            const errorMsg = e.message || JSON.stringify(e);

            if (errorMsg.includes('not found') || errorMsg.includes('invalid') || errorMsg.includes('closed')) {
                console.warn(`⚠️ Ordem ${idToCancel} não existe mais. Limpando memória.`);
                this.activeOrderId = null;
                this.activeOrderPrice = 0;
                this.status = BotStatus.IDLE;
            }
            else {
                console.error(`❌ Falha ao cancelar (Rede/API). Vamos tentar de novo no próximo tick.`);
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