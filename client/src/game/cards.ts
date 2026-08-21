import CARD_URLS, { type CardSuit } from "./cardsManifest";

const CACHE_PREFIX = "truco-tche:card-url:";

export const CARD_IMGS = CARD_URLS;

export function cimg(card: { suit: CardSuit; rank: number }): string {
  const url = CARD_URLS[card.suit]?.[card.rank] || "";
  if (url) {
    try { localStorage.setItem(`${CACHE_PREFIX}${card.suit}:${card.rank}`, url); } catch {}
  }
  return url;
}

export function preloadCard(card: { suit: CardSuit; rank: number }): void {
  const url = cimg(card);
  if (!url) return;
  const image = new Image();
  image.src = url;
}

export function preloadCards(cards: Array<{ suit: CardSuit; rank: number }>): void {
  cards.forEach(preloadCard);
}

declare global {
  interface Window { __TRUCO_CARD_IMGS?: typeof CARD_IMGS; }
}
