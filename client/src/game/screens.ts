import { legacyMarkup } from "./legacyMarkup";

export function mountLegacyScreens(container: HTMLElement): void {
  container.innerHTML = legacyMarkup;
}

export function registerPwa(): void {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
