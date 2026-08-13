# Contexto da Cópia de Desenvolvimento — Truco Tchê

## Objetivo

Esta pasta é uma cópia independente do projeto original `/home/ubuntu/truco-tche`, criada para continuar o desenvolvimento em uma nova tarefa, sem modificar diretamente o projeto original.

## Estado preservado

A cópia mantém o código do jogo offline contra IA, o modo online baseado em Socket.io, autenticação local e OAuth, moeda virtual Pilas, integração com Mercado Pago, ranking, torneios, patrocinadores, painel administrativo, histórico, testes automatizados, migrações Drizzle, documentação de regras e o relatório de auditoria.

## Versão de origem

- Commit de origem: `52b5a944`
- Caminho original: `/home/ubuntu/truco-tche`
- Caminho da cópia: `/home/ubuntu/truco-tche-dev`
- Projeto original publicado nos domínios `trucotche.manus.space` e `trucotche-qwnvtjyz.manus.space`.

## Histórico técnico importante

O front-end principal é um SPA monolítico em `client/index.html`, com telas controladas por JavaScript. O back-end utiliza Express, tRPC, Socket.io, Drizzle ORM e MySQL/TiDB. A lógica compartilhada de cartas e regras fica em `shared/gameEngine.ts`.

O modo online possui autenticação de socket, salas, matchmaking, jogo autoritativo no servidor, timeout de turno de 30 segundos, reconexão com janela de tolerância, histórico de partidas e modo espectador. O caminho Socket.io em produção é `/api/socketio`, porque a infraestrutura publicada roteia os endpoints `/api/*` para o servidor Node.

Foi corrigido um conflito em produção no qual o `spaceEditor` podia sobrescrever `window.io`; a implementação passou a capturar o cliente Socket.io em `window._sioFn` quando aplicável. Qualquer alteração futura no carregamento do Socket.io deve preservar essa compatibilidade.

## Regras que não devem ser alteradas sem decisão explícita

O baralho usa 40 cartas espanholas, sem 8 e 9, com hierarquia e valores de envido já implementados no motor compartilhado. As cadeias de Truco, Envido e Flor, a pontuação até 12, a regra de mão, empates e o timeout de 30 segundos devem permanecer compatíveis com `shared/gameEngine.ts` e com o jogo vs IA.

## Arquivos de referência

- `client/index.html`: interface principal e fluxos existentes.
- `shared/gameEngine.ts`: regras e estado compartilhado.
- `server/socketServer.ts`: servidor multiplayer atual.
- `server/routers.ts`: procedimentos tRPC.
- `drizzle/schema.ts`: modelo de dados.
- `todo.md`: histórico de implementação e pendências.
- `auditoria_sistema.md`: auditoria técnica anterior.
- `regras_truco_tche.md`: documento completo de regras.

## Próximo trabalho recomendado

Antes de reescrever o multiplayer, executar os testes existentes, revisar os eventos de Socket.io comparando-os com os handlers do `client/index.html`, corrigir rotas e handlers órfãos identificados pela auditoria e criar testes de integração para dois clientes autenticados. Não remover nem substituir o modo offline durante essa evolução.

## Política de desenvolvimento

Toda nova alteração deve ser registrada em `todo.md`, coberta por testes quando aplicável, validada no preview e salva em checkpoint antes de ser considerada pronta. O projeto original deve permanecer intacto; mudanças desta linha de desenvolvimento devem ocorrer somente nesta cópia.
