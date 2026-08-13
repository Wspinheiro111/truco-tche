# Reconciliação da Migração para Manus

O projeto `truco-tche-dev` foi transferido para `truco-tche-manus` mantendo a interface HTML legada, o motor compartilhado, os routers tRPC, a autenticação local, o Socket.IO e o schema Drizzle. Os arquivos de metadados do projeto Manus e os módulos exclusivos do destino, incluindo `server/_core/heartbeat.ts` e `server/_core/storageProxy.ts`, foram preservados no destino.

| Área | Implementação preservada | Evidência de validação |
|---|---|---|
| Socket.IO | `initSocketServer(server)` continua registrado no entry point em `/api/socketio`. | O cliente Socket.IO respondeu `200`; testes de criação de sala, distribuição de cartas e reconexão foram concluídos. |
| Webhook Pix | A rota `/api/webhooks/mercadopago` usa `verifyMercadoPagoWebhookSignature`. | Três testes unitários cobrem assinatura válida, payload adulterado e metadados ausentes. Sem secret configurado, o bypass é limitado ao desenvolvimento. |
| Fallback SPA | Rotas não-API são atendidas por Vite em desenvolvimento e por `serveStatic` em produção. | `GET /partida/inexistente` retornou `200` e a página `Truco Tchê`; a rota Socket.IO permanece isolada. |
| Banco gerenciado | O `DATABASE_URL` nativo do projeto Manus é usado pelo pool MySQL. | As 16 tabelas de domínio e autenticação foram verificadas no banco gerenciado. |

## Reconciliação do schema legado

As 14 migrações históricas foram aplicadas na ordem original. O schema TypeScript da origem continha três campos já utilizados pelo código, porém ausentes do histórico de migrações: `users.googleLinked`, `sponsors.dailyImpressionGoal` e `sponsors.startDate`. A migração complementar `0014_manus_schema_reconciliation.sql` foi criada e aplicada para alinhar o banco ao contrato usado em runtime.

> As credenciais `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` permanecem deliberadamente pendentes, conforme solicitação do usuário. Sem elas, pagamentos Pix reais ficam desabilitados, mas o jogo, o banco, a autenticação e o multiplayer seguem disponíveis.
