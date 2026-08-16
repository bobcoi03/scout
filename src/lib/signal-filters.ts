// Keep this deterministic filter deliberately narrow. Crypto is a valid product
// category in Scout; only unmistakable token-promotion mechanics are blocked
// before the analyst gets a chance to judge the actual product.
const obviousTokenPromotionPattern = /\b(?:airdrop|presale|memecoin|meme coin|token launch|whitelist spot|crypto giveaway|100x|crypto signals|fair launch)\b/i;
const cryptoTickerPattern = /(?:^|[^\w$])\$[a-z][a-z0-9_]{1,19}\b/i;
const cryptoContractPattern = /\b(?:ca|contract(?:\s+address)?)\s*[:：]\s*(?:0x[a-f0-9]{20,}|[1-9a-hj-np-z]{30,})\b/i;
const cryptoTokenomicsPattern = /\b(?:buy\s*backs?\s+(?:our\s+|the\s+)?token|buying back\s+(?:our\s+|the\s+)?token|tokenomics|token presale|protocol fees?.{0,100}token|fees?.{0,100}(?:buy\s*back|burn).{0,50}token|value flows? back into (?:our|the) token|guaranteed returns?|risk[- ]free returns?)\b/i;

export function isCryptoPromotionText(text: string) {
  return obviousTokenPromotionPattern.test(text)
    || cryptoTickerPattern.test(text)
    || cryptoContractPattern.test(text)
    || cryptoTokenomicsPattern.test(text);
}
