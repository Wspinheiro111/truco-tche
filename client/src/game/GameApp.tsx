import { useEffect, useRef } from "react";
import { exposeLegacyAuthState } from "./auth";
import { CARD_IMGS } from "./cards";
import { CHARS } from "./characters";
import {
  calcEnvido, envidoValue, isManilha, makeDeck, RANKS, shuffleDeck,
  SUITS, TARGET_1V1, TRUCO_NAMES, TRUCO_POINTS, trucoValue,
} from "@shared/gameEngine";
import { mountLegacyScreens, registerPwa } from "./screens";
import { ensureInPersonQrLibraries, prepareSocketIo } from "./socket";
import { startLegacySponsorHooks } from "./sponsors";
import "./game.css";
import { bootLegacyRuntime } from "./legacyRuntime";

const offlineGame = {
  CHARS,
  SUITS,
  RANKS,
  TARGET_1v1: TARGET_1V1,
  TT_TN: TRUCO_NAMES,
  TT_TP: TRUCO_POINTS,
  tv: trucoValue,
  ev: envidoValue,
  isMan: isManilha,
  makeDeck: () => shuffleDeck(makeDeck()),
  calcEnvido,
};

declare global {
  interface Window {
    __TRUCO_OFFLINE_GAME: typeof offlineGame;
  }
}

export default function GameApp() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    exposeLegacyAuthState();
    window.__TRUCO_CARD_IMGS = CARD_IMGS;
    window.__TRUCO_OFFLINE_GAME = offlineGame;
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
