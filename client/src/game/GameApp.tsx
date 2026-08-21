import { useEffect, useRef } from "react";
import { exposeLegacyAuthState } from "./auth";
import { CARD_IMGS } from "./cards";
import { mountLegacyScreens, registerPwa } from "./screens";
import { ensureInPersonQrLibraries, prepareSocketIo } from "./socket";
import { startLegacySponsorHooks } from "./sponsors";
import "./game.css";
import { bootLegacyRuntime } from "./legacyRuntime";

export default function GameApp() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    exposeLegacyAuthState();
    window.__TRUCO_CARD_IMGS = CARD_IMGS;
    mountLegacyScreens(hostRef.current);
    registerPwa();
    window.__trucoEnsureQrLibraries = ensureInPersonQrLibraries;
    prepareSocketIo()
      .then(() => bootLegacyRuntime())
      .then(startLegacySponsorHooks)
      .catch(error => console.warn("[Runtime do jogo]", error));
    return () => { hostRef.current?.replaceChildren(); };
  }, []);

  return <div ref={hostRef} id="truco-game-root" />;
}
