import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_IMGS, cimg, preloadCard, preloadCards } from "./cards";

describe("adaptador modular de cartas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expõe URLs HTTPS para as quarenta cartas sem conteúdo Base64", () => {
    const urls = Object.values(CARD_IMGS).flatMap((suit) => Object.values(suit));
    expect(urls).toHaveLength(40);
    expect(urls.every((url) => url.startsWith("https://") && !url.startsWith("data:"))).toBe(true);
  });

  it("resolve a carta e salva a URL gerenciada no cache local", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });

    const url = cimg({ suit: "Espadas", rank: 1 });

    expect(url).toMatch(/^https:\/\//);
    expect(setItem).toHaveBeenCalledWith("truco-tche:card-url:Espadas:1", url);
    expect(cimg({ suit: "Espadas", rank: 8 })).toBe("");
  });

  it("faz preload somente para cartas resolvidas", () => {
    const created: Array<{ src: string }> = [];
    vi.stubGlobal("Image", class {
      src = "";
      constructor() { created.push(this); }
    });

    preloadCards([{ suit: "Ouros", rank: 7 }, { suit: "Copas", rank: 12 }]);
    preloadCard({ suit: "Bastos", rank: 8 });

    expect(created).toHaveLength(2);
    expect(created.every((image) => image.src.startsWith("https://"))).toBe(true);
  });
});
