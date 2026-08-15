import { adminProcedure, router } from "./_core/trpc";
import { runRulesSelfCheck } from "./rulesTestRunner";

export const RULES_TEST_REPORT = {
  suite: "shared/gameEngine.test.ts",
  summary: {
    covered: 20,
    categories: 3,
    runner: "Vitest",
  },
  groups: [
    {
      id: "truco",
      title: "Truco",
      description: "Apostas, aceite, recusa e proteção contra repetição de eventos.",
      scenarios: [
        "Chamar Truco no turno autorizado",
        "Aceitar e retomar a rodada",
        "Recusar e atribuir os pontos ao chamador",
        "Bloquear nova chamada ou aceite duplicado",
        "Respeitar a jogada de carta e o prazo de turno",
      ],
    },
    {
      id: "envido",
      title: "Envido",
      description: "Disponibilidade antes da primeira carta, desempate pela mão e encerramento por pontuação.",
      scenarios: [
        "Bloquear Envido após a primeira carta",
        "Resolver empate em favor do mão",
        "Encerrar a partida ao alcançar a pontuação-alvo",
        "Preservar a visão privada das cartas do oponente",
      ],
    },
    {
      id: "flor",
      title: "Flor",
      description: "Sequência de Flor e Contra-Flor, com cálculo e confirmação de pontos.",
      scenarios: [
        "Reconhecer disponibilidade de Flor",
        "Permitir Contra-Flor pelo respondente",
        "Confirmar a cadeia de aumento e seus pontos",
        "Recuperar negociação pendente no cliente",
      ],
    },
  ],
} as const;

export const rulesTestRouter = router({
  report: adminProcedure.query(() => {
    const execution = runRulesSelfCheck();
    return {
      ...RULES_TEST_REPORT,
      execution,
      generatedAt: new Date().toISOString(),
    };
  }),
});
