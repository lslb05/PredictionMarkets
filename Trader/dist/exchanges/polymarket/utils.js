"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOB_API_URL = exports.GAMMA_API_URL = void 0;
exports.mapMarketToUnified = mapMarketToUnified;
exports.mapIntervalToFidelity = mapIntervalToFidelity;
exports.GAMMA_API_URL = 'https://gamma-api.polymarket.com/events';
exports.CLOB_API_URL = 'https://clob.polymarket.com';
function mapMarketToUnified(event, market, options = {}) {
    if (!market)
        return null;
    const outcomes = [];
    // Polymarket Gamma often returns 'outcomes' and 'outcomePrices' as stringified JSON keys.
    let outcomeLabels = [];
    let outcomePrices = [];
    try {
        outcomeLabels = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes || []);
        outcomePrices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices || []);
    }
    catch (e) {
        console.warn(`Error parsing outcomes for market ${market.id}:`, e);
    }
    // Extract CLOB token IDs for granular operations
    let clobTokenIds = [];
    try {
        clobTokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
    }
    catch (e) {
        // console.warn(`Error parsing clobTokenIds for market ${market.id}`, e);
    }
    // Extract candidate/option name from market question for better outcome labels
    let candidateName = null;
    if (market.groupItemTitle) {
        candidateName = market.groupItemTitle;
    }
    else if (market.question && options.useQuestionAsCandidateFallback) {
        // Fallback or sometimes question is the candidate name in nested structures
        // Only used if explicitly requested (e.g. for getMarketsBySlug)
        candidateName = market.question;
    }
    if (outcomeLabels.length > 0) {
        outcomeLabels.forEach((label, index) => {
            const rawPrice = outcomePrices[index] || "0";
            // For Yes/No markets with specific candidates, use the candidate name
            let outcomeLabel = label;
            if (candidateName && label.toLowerCase() === 'yes') {
                outcomeLabel = candidateName;
            }
            else if (candidateName && label.toLowerCase() === 'no') {
                outcomeLabel = `Not ${candidateName}`;
            }
            // 24h Price Change
            // Polymarket API provides 'oneDayPriceChange' on the market object
            let priceChange = 0;
            if (index === 0 || label.toLowerCase() === 'yes' || (candidateName && label === candidateName)) {
                priceChange = Number(market.oneDayPriceChange || 0);
            }
            outcomes.push({
                id: clobTokenIds[index] || String(index), // Use CLOB Token ID as the primary ID
                label: outcomeLabel,
                price: parseFloat(rawPrice) || 0,
                priceChange24h: priceChange,
                metadata: {
                    // clobTokenId is now the main ID, but keeping it in metadata for backward compat if needed
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
        tags: event.tags?.map((t) => t.label) || []
    };
}
function mapIntervalToFidelity(interval) {
    const mapping = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1h': 60,
        '6h': 360,
        '1d': 1440
    };
    return mapping[interval];
}
