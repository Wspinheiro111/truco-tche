import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { notifyOwner } from "./_core/notification";
import { adminProcedure, router } from "./_core/trpc";
import {
  getRulesTestExecution,
  listRecentRulesTestExecutions,
  recordRulesTestExecution,
  RulesTestExecutionHistoryRow,
  setRulesTestExecutionOwnerNotification,
} from "./db";
import { runRulesSelfCheck } from "./rulesTestRunner";
import { emitRulesTestFailureToAdmins } from "./socketServer";

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

type FailedCheck = { title: string; group: string; detail?: string };

function parseFailedChecks(raw: string): FailedCheck[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is FailedCheck => typeof item?.title === "string" && typeof item?.group === "string")
      .map(item => ({ title: item.title, group: item.group, detail: typeof item.detail === "string" ? item.detail : undefined }));
  } catch {
    return [];
  }
}

export function formatRulesTestExecution(row: RulesTestExecutionHistoryRow) {
  return {
    id: Number(row.id),
    status: row.status,
    passedChecks: Number(row.passedChecks),
    totalChecks: Number(row.totalChecks),
    failedChecks: parseFailedChecks(row.failedChecksJson),
    executedByName: row.executedByName ?? "Administrador",
    ownerNotified: Boolean(row.ownerNotified),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function csvCell(value: unknown): string {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

export function buildRulesFailureCsv(row: RulesTestExecutionHistoryRow): string {
  const execution = formatRulesTestExecution(row);
  const header = ["execucao_id", "executado_em", "executado_por", "grupo", "check", "detalhe", "checks_aprovados", "checks_totais", "proprietario_notificado"];
  const rows = execution.failedChecks.map(check => [
    execution.id,
    execution.createdAt,
    execution.executedByName,
    check.group,
    check.title,
    check.detail ?? "",
    execution.passedChecks,
    execution.totalChecks,
    execution.ownerNotified ? "sim" : "nao",
  ].map(csvCell).join(";"));
  return [header.map(csvCell).join(";"), ...rows].join("\n");
}

export const rulesTestRouter = router({
  report: adminProcedure
    .input(z.object({ smokeFailure: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
    if (input?.smokeFailure && process.env.NODE_ENV === "production") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Smoke de falha indisponível em produção." });
    }
    const baseExecution = runRulesSelfCheck();
    const execution = input?.smokeFailure
      ? {
          ...baseExecution,
          checks: [...baseExecution.checks, { id: "smoke_failure", title: "Falha controlada de smoke", group: "truco", passed: false, detail: "Validação controlada do alerta administrativo." }],
          total: baseExecution.total + 1,
          overall: "failed" as const,
        }
      : baseExecution;
    const failedChecks: FailedCheck[] = execution.checks
      .filter(check => !check.passed)
      .map(check => ({ title: check.title, group: check.group, detail: check.detail }));
    const executionId = await recordRulesTestExecution({
      status: execution.overall === "passed" ? "passed" : "failed",
      passedChecks: execution.passed,
      totalChecks: execution.total,
      failedChecks,
      executedById: ctx.user.id,
      executedByName: ctx.user.name,
    });

    let ownerNotified = false;
    if (execution.overall === "failed" && executionId) {
      ownerNotified = input?.smokeFailure
        ? false
        : await notifyOwner({
            title: "Falha na autoverificação do Truco Tchê",
            content: `${failedChecks.length} check(s) reprovado(s) na execução #${executionId}. Abra o painel administrativo para revisar o diagnóstico.`,
          });
      await setRulesTestExecutionOwnerNotification(executionId, ownerNotified);
      emitRulesTestFailureToAdmins({
        executionId,
        passed: execution.passed,
        total: execution.total,
        failedChecks,
        createdAt: new Date().toISOString(),
      });
    }

    const history = (await listRecentRulesTestExecutions(15)).map(formatRulesTestExecution);
    return {
      ...RULES_TEST_REPORT,
      execution,
      audit: { executionId, ownerNotified },
      history,
      generatedAt: new Date().toISOString(),
    };
  }),

  history: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => (await listRecentRulesTestExecutions(input?.limit ?? 15)).map(formatRulesTestExecution)),

  latestFailures: adminProcedure
    .input(z.object({ afterId: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => (await listRecentRulesTestExecutions(50))
      .filter(row => row.status === "failed" && Number(row.id) > input.afterId)
      .map(formatRulesTestExecution)
      .sort((a, b) => a.id - b.id)),

  exportFailure: adminProcedure
    .input(z.object({ executionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getRulesTestExecution(input.executionId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Execução de regras não encontrada." });
      if (row.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "Somente falhas possuem diagnóstico para exportação." });
      return {
        executionId: Number(row.id),
        filename: `diagnostico-regras-falha-${Number(row.id)}.csv`,
        csv: buildRulesFailureCsv(row),
      };
    }),
});
