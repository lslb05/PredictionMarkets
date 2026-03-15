export interface MarketConfig {
    name: string; 
    kalshiTicker: string;
    polyYesId: string;
    polyNoId: string;
    minProfit: number;
}

export const MARKETS: MarketConfig[] = [
    {
        name: "FED",
        kalshiTicker: 'KXFEDDECISION-26MAR-C25',
        polyYesId: '62938043365772447095885755955446362343142416536419862840923032141775380249586',
        polyNoId:  '89036168105179001192755120118050209760422683300339582903158940882158509550672',
        minProfit: 4.9
    },
    {
        name: "FED June",
        kalshiTicker: 'KXFEDDECISION-26JUN-C25',
        polyYesId: '65193234666628291664907888364936366210889305490897648116746073820519263548476',
        polyNoId:  '28290293140018107764072370767749010110409017615323596573647425138985988593200',
        minProfit: 5.9
    }
];