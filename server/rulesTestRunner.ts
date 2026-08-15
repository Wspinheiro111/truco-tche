import { acceptTruco, callEnvido, callFlor, callTruco, createGameState, dealHand, getPlayerView, playCard } from "../shared/gameEngine";

type RuleCheck = { id: string; group: "truco" | "envido" | "flor"; title: string; passed: boolean; detail: string };

function captureCheck(id: string, group: RuleCheck["group"], title: string, run: () => void): RuleCheck {
  try {
    run();
    return { id, group, title, passed: true, detail: "Verificação concluída" };
  } catch (error) {
    return { id, group, title, passed: false, detail: error instanceof Error ? error.message : "Falha desconhecida" };
  }
}

export function runRulesSelfCheck() {
  const checks: RuleCheck[] = [
    captureCheck("truco-accept", "truco", "Truco é aceito e a rodada continua", () => {
      const dealt = dealHand(createGameState(101));
      const accepted = acceptTruco(callTruco(dealt, dealt.turn));
      if (accepted.phase !== "playing" || accepted.trucoLevel !== 2) throw new Error("Aceite de Truco inválido");
    }),
    captureCheck("envido-before-card", "envido", "Envido fica bloqueado após a primeira carta", () => {
      const dealt = dealHand(createGameState(102));
      const player = dealt.turn;
      const afterCard = playCard(dealt, player, dealt.hands[player][0].id).state;
      let blocked = false;
      try { callEnvido(afterCard, afterCard.turn, "envido"); } catch { blocked = true; }
      if (!blocked) throw new Error("Envido foi aceito após a primeira carta");
    }),
    captureCheck("envido-start", "envido", "Envido inicia antes da primeira carta", () => {
      const dealt = { ...dealHand(createGameState(103)), hasFlor: { p1: false, p2: false } };
      const pending = callEnvido(dealt, dealt.turn, "envido");
      if (pending.phase !== "envido_neg") throw new Error("Negociação de Envido não foi aberta");
    }),
    captureCheck("flor-counter", "flor", "Flor permite Contra-Flor ao respondente", () => {
      const dealt = { ...dealHand(createGameState(104)), hasFlor: { p1: true, p2: true } };
      const flor = callFlor(dealt, dealt.turn, "flor");
      const counter = callFlor(flor, flor.turn, "contra_flor");
      if (counter.florChain.join(",") !== "flor,contra_flor") throw new Error("Contra-Flor não foi registrada");
    }),
    captureCheck("private-view", "truco", "Visão privada não expõe a mão adversária", () => {
      const dealt = dealHand(createGameState(105));
      const view = getPlayerView(dealt, "p1");
      if ("hands" in view || view.myHand.length !== 3 || view.opponentCardCount !== 3) throw new Error("Visão privada expôs cartas indevidamente");
    }),
  ];
  return { checks, passed: checks.filter(check => check.passed).length, total: checks.length, overall: checks.every(check => check.passed) ? "passed" as const : "failed" as const };
}
