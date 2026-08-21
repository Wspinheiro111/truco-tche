export function startLegacySponsorHooks(): void {
  // O runtime legado expõe os hooks de patrocínio após inicializar as telas.
  window.dispatchEvent(new Event("truco:sponsors-ready"));
}
