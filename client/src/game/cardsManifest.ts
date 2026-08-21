export type CardSuit = "Ouros" | "Bastos" | "Espadas" | "Copas";

const CARD_PATHS: Record<CardSuit, Record<number, string>> = {
  "Ouros": {
    "1": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-1.jpg",
    "2": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-2.jpg",
    "3": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-3.jpg",
    "4": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-4.jpg",
    "5": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-5.jpg",
    "6": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-6.jpg",
    "7": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-7.jpg",
    "10": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-10.jpg",
    "11": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-11.jpg",
    "12": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/ouros-12.jpg"
  },
  "Bastos": {
    "1": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-1.jpg",
    "2": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-2.jpg",
    "3": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-3.jpg",
    "4": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-4.jpg",
    "5": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-5.jpg",
    "6": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-6.jpg",
    "7": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-7.jpg",
    "10": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-10.jpg",
    "11": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-11.jpg",
    "12": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/bastos-12.jpg"
  },
  "Espadas": {
    "1": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-1.jpg",
    "2": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-2.jpg",
    "3": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-3.jpg",
    "4": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-4.jpg",
    "5": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-5.jpg",
    "6": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-6.jpg",
    "7": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-7.jpg",
    "10": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-10.jpg",
    "11": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-11.jpg",
    "12": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/espadas-12.jpg"
  },
  "Copas": {
    "1": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-1.jpg",
    "2": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-2.jpg",
    "3": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-3.jpg",
    "4": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-4.jpg",
    "5": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-5.jpg",
    "6": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-6.jpg",
    "7": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-7.jpg",
    "10": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-10.jpg",
    "11": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-11.jpg",
    "12": "https://d2xsxph8kpxj0f.cloudfront.net/310519663158668192/CUt9vR7PFfxqb8MoERpcpk/truco-tche/cards/copas-12.jpg"
  }
};

export const CARD_URLS: Record<CardSuit, Record<number, string>> = Object.fromEntries(
  Object.entries(CARD_PATHS).map(([suit, ranks]) => [suit, Object.fromEntries(Object.entries(ranks).map(([rank, path]) => [Number(rank), typeof window === "undefined" ? path : new URL(path, window.location.origin).href]))])
) as Record<CardSuit, Record<number, string>>;

export default CARD_URLS;
