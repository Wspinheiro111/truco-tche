# Parecer Gemini — Multiplayer do Truco Tchê

O Gemini avaliou a prontidão atual do multiplayer em **6/10**: há uma base de autenticação, salas, motor compartilhado e persistência de resultado, mas o estado exclusivamente em memória não é seguro no modo Autoscale.

| Prioridade | Risco apontado | Direção recomendada |
|---|---|---|
| P0 | Perda de estado e jogadores conectados em instâncias distintas | Persistir o snapshot completo da partida ativa e permitir recuperação por participante. |
| P1 | Processamento concorrente da mesma jogada | Usar `version` em atualização condicional, recarregando estado em conflito. |
| P1 | Timer e reconexão perdidos após reinício | Salvar o prazo absoluto do turno e recalcular o tempo restante ao restaurar. |
| P2 | Eventos duplicados e diagnóstico insuficiente | Tornar operações idempotentes e registrar eventos críticos com IDs de partida e jogador. |

O roteiro recomendado é: modelar o snapshot, persistir e carregar transições, aplicar lock otimista, recuperar turno e reconexão, tratar idempotência e adicionar observabilidade.

## Implementação concluída

O estado ativo passou a ser registrado em `activeOnlineGames`, com `stateJson`, `version`, prazo absoluto de turno e último evento. As transições de cartas, Truco, Envido, Flor, desistência, timeout, próxima mão e término usam atualização condicional por versão. A reconexão recupera a visão privada do jogador, reabre negociações pendentes e volta a sincronizar o snapshot. Salas aguardando jogador também são persistidas, listadas e reservadas de forma atômica entre instâncias.

Os smoke tests confirmaram: (1) criação de partida, reinício do servidor, reconexão simultânea dos dois jogadores e persistência da primeira jogada; (2) sala aguardando jogador criada antes do reinício, recuperação do anfitrião, listagem pelo convidado e início com três cartas privadas para cada lado; (3) conflito de Truco entre duas instâncias, com uma só transição persistida; (4) recuperação de Truco e Envido pendentes para o respondente em instância distinta, além da execução coberta do restaurador de interface para Truco, Envido e Flor; e (5) exclusão persistida de sala expirada, mesmo sem depender do timer local. Contas temporárias de validação foram removidas após os testes.

Os smoke tests reproduzíveis estão em `scripts/smoke-cross-instance.mjs`, `scripts/smoke-recovered-envido.mjs` e `scripts/smoke-atomic-join.mjs`. Eles devem ser executados com a aplicação em `localhost:3000`; o primeiro e o segundo também requerem uma segunda instância em `localhost:3001` para simular processos Autoscale distintos.
