import { UnifiedMarket, MarketOutcome, CandleInterval } from '../../types';

export const GAMMA_API_URL = 'https://gamma-api.polymarket.com/events';
export const CLOB_API_URL = 'https://clob.polymarket.com';

export function mapMarketToUnified(event: any, market: any, options: { useQuestionAsCandidateFallback?: boolean } = {}): UnifiedMarket | null {
    if (!market) return null;

    const outcomes: MarketOutcome[] = [];

    let outcomeLabels: string[] = [];
    let outcomePrices: string[] = [];

    try {
        outcomeLabels = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes || []);
        outcomePrices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices || []);
    } catch (e) {
        console.warn(`Error parsing outcomes for market ${market.id}:`, e);
    }

    let clobTokenIds: string[] = [];
    try {
        clobTokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
    } catch (e) {
    
    }

    
    let candidateName: string | null = null;
    if (market.groupItemTitle) {
        candidateName = market.groupItemTitle;
    } else if (market.question && options.useQuestionAsCandidateFallback) {
        candidateName = market.question;
    }

    if (outcomeLabels.length > 0) {
        outcomeLabels.forEach((label: string, index: number) => {
            const rawPrice = outcomePrices[index] || "0";

            let outcomeLabel = label;
            if (candidateName && label.toLowerCase() === 'yes') {
                outcomeLabel = candidateName;
            } else if (candidateName && label.toLowerCase() === 'no') {
                outcomeLabel = `Not ${candidateName}`;
            }

            let priceChange = 0;
            if (index === 0 || label.toLowerCase() === 'yes' || (candidateName && label === candidateName)) {
                priceChange = Number(market.oneDayPriceChange || 0);
            }

            outcomes.push({
                id: clobTokenIds[index] || String(index),
                label: outcomeLabel,
                price: parseFloat(rawPrice) || 0,
                priceChange24h: priceChange,
                metadata: {
                    clobTokenId: clobTokenIds[index]
                }
            });
        });
    }

    return {
        id: market.id,
        title: market.question ? `${event.title} - ${market.question}` : event.title,
        description: market.description || event.description,
        outcomes: outcomes,
        resolutionDate: market.endDate ? new Date(market.endDate) : (market.end_date_iso ? new Date(market.end_date_iso) : new Date()),
        volume24h: Number(market.volume24hr || market.volume_24h || 0),
        volume: Number(market.volume || 0),
        liquidity: Number(market.liquidity || market.rewards?.liquidity || 0),
        openInterest: Number(market.openInterest || market.open_interest || 0),
        url: `https://polymarket.com/event/${event.slug}`,
        image: event.image || market.image || `https://polymarket.com/api/og?slug=${event.slug}`,
        category: event.category || event.tags?.[0]?.label,
        tags: event.tags?.map((t: any) => t.label) || []
    };
}

export function mapIntervalToFidelity(interval: CandleInterval): number {
    const mapping: Record<CandleInterval, number> = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1h': 60,
        '6h': 360,
        '1d': 1440
    };
    return mapping[interval];
}