# Projeto TODO

- [x] Inventariar arquivos, dependências e migrações da origem `truco-tche-dev`.
- [x] Preservar os arquivos de infraestrutura Manus do destino e preparar a migração compatível.
- [x] Migrar motor de jogo, Socket.IO, autenticação, routers, schema, testes e interface legada.
- [x] Instalar e validar dependências extras exigidas pelo projeto migrado.
- [x] Aplicar as 14 migrações do Drizzle ao banco MySQL gerenciado.
- [x] Aplicar a reconciliação adicional do schema para as colunas `googleLinked`, `dailyImpressionGoal` e `startDate`, ausentes do histórico legado.
- [x] Reconciliar extensões de `server/_core` com a infraestrutura Manus, preservando Socket.IO, webhook e fallback SPA.
- [x] Validar o runtime Manus após a instalação das dependências, incluindo healthcheck e carregamento da interface legada.
- [x] Documentar a reconciliação de infraestrutura e schema em `MIGRACAO_MANUS.md`.
- [x] Adiar a configuração dos secrets `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET`, mantendo pagamentos Pix reais desabilitados nesta etapa.
- [x] Registrar a configuração das credenciais Mercado Pago como etapa futura, conforme solicitado pelo usuário.
- [x] Executar TypeScript, testes e build com a contagem esperada de 108 testes aprovados.
- [x] Realizar teste funcional de sala, início de partida e reconexão no multiplayer.
- [x] Salvar checkpoint inicial da migração e orientar o usuário a publicar pelo painel Manus.
- [x] Adicionar painel de salas ativas na interface principal com atualização em tempo real.
- [x] Permitir entrada direta em uma sala aguardando jogador a partir do painel.
- [x] Validar visualmente e por Socket.IO a listagem, a atualização em tempo real e a entrada em salas ativas.
