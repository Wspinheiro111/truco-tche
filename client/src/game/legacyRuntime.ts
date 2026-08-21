let bootPromise: Promise<void> | null = null;

export function bootLegacyRuntime(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/game-runtime.js";
    script.async = false;
    script.onload = () => {
      if (document.readyState !== "loading") {
        document.dispatchEvent(new Event("DOMContentLoaded"));
        window.dispatchEvent(new Event("load"));
      }
      resolve();
    };
    script.onerror = () => reject(new Error("Não foi possível carregar o runtime do Truco Tchê"));
    document.body.appendChild(script);
  });
  return bootPromise;
}
