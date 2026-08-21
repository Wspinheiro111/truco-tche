const loadedScripts = new Map<string, Promise<void>>();

function loadExternalScript(src: string): Promise<void> {
  const existing = loadedScripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

export async function prepareSocketIo(): Promise<void> {
  if (typeof window._sioFn === "function") return;
  await loadExternalScript("/api/socketio/socket.io.js");
  window._sioFn = typeof window.io === "function" ? window.io : null;
  window._sioClientReady = Boolean(window._sioFn);
}

export async function ensureInPersonQrLibraries(): Promise<void> {
  await Promise.all([
    typeof window.QRCode === "undefined" ? loadExternalScript("https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js") : Promise.resolve(),
    typeof window.Html5Qrcode === "undefined" ? loadExternalScript("https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js") : Promise.resolve(),
  ]);
}

declare global {
  interface Window {
    _sioFn?: unknown;
    _sioClientReady?: boolean;
    QRCode?: unknown;
    Html5Qrcode?: unknown;
    Peer?: unknown;
    __trucoEnsureQrLibraries?: () => Promise<void>;
    io?: unknown;
  }
}
