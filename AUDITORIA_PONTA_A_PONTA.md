# Auditoria ponta a ponta — Truco Tchê

**Data:** 14 de agosto de 2026  
**Escopo:** interface, rotas HTTP, autenticação local, Socket.IO, regras de jogo, banco MySQL, build, logs e dependências de produção.

> Esta auditoria combina revisão estática, testes unitários, smoke tests com múltiplos sockets, chamadas HTTP locais e verificação visual. Ela reduz riscos conhecidos, mas não prova ausência absoluta de defeitos nem substitui testes de carga ou uma revisão externa de segurança.

## Fluxos verificados

| Área | Evidência | Situação |
|---|---|---|
| Página principal, painel de salas e contador online | Renderização visual e console sem erros recentes | Aprovado |
| Fallback SPA, healthcheck e cliente Socket.IO | `200` em rota SPA, `/api/health` e `/api/socketio/socket.io.js` | Aprovado |
| Salas, entrada direta e reconexão | Smoke tests de criação, entrada, atualização e reconexão | Aprovado após correção |
| Autenticação de socket | Socket sem sessão rejeitado em `reconnect_game` | Aprovado após correção |
| Motor de jogo | Testes de Envido decisivo e Contra-Flor adicionados | Aprovado após correção |
| Banco gerenciado | Schema e persistência de salas validados em testes anteriores | Aprovado |
| TypeScript, testes e build | `pnpm check`, `pnpm test` e `pnpm build` executados após as correções | Aprovado: 114 testes, 1 ignorado e build concluída |

A verificação visual final confirmou carregamento da página inicial, contador de jogadores online e painel de salas sem exceções observáveis no console recente.

## Falhas confirmadas e corrigidas

| ID | Gravidade | Achado | Evidência | Correção aplicada |
|---|---|---|---|---|
| SEC-01 | Alta | Um socket sem autenticação podia retomar uma partida usando o `userId` de outra pessoa e receber a visão privada da mão. | O smoke test retornou `success: true` e `receivedPrivateState: true` para um atacante sem sessão. | `reconnect_game` agora deriva usuário e nome apenas de `socketToUser`; o cliente só tenta reconectar após confirmação de autenticação. |
| GAME-01 | Alta | Aceitar Envido ou Flor que alcançava o alvo mantinha a partida em `playing`. | Teste temporário recebeu `playing` em vez de `game_over` com placar 11–0 e Envido aceito. | Envido e Flor, aceitos ou recusados, agora encerram a partida ao atingir o alvo e chamam `endOnlineGame`. |
| GAME-02 | Média | Contra-Flor não era possível: o motor aceitava o rótulo, mas bloqueava qualquer chamada após a primeira Flor. | Teste temporário falhou com `Not p2's turn`. | Sequência `flor → contra_flor → contra_flor_resto` implementada no motor e exposta no modal online. |
| AUTH-01 | Alta | O cliente controlava a origem usada no link de recuperação de PIN. | `forgotPin` aceitava e repassava `origin` diretamente ao e-mail. | A origem passou a ser definida pelo servidor, com valor canônico do projeto e suporte a `PUBLIC_APP_URL`. |
| AUTH-02 | Alta | Token de recuperação podia ser validado por duas requisições concorrentes antes de ser consumido. | Consulta, alteração de PIN e consumo eram operações separadas. | O consumo agora usa atualização condicional por token, expiração e uso prévio; apenas uma requisição vence. |
| DATA-01 | Média | Histórico aceitava duração negativa e resultados incompatíveis com o placar. | `durationSeconds` não tinha limite mínimo e o resultado era independente do placar. | Duração limitada entre 0 e 86.400 segundos; quando os dois placares existem, vitória e derrota precisam ser coerentes. |
| SEC-02 | Alta | Dados de patrocinadores eram interpolados diretamente em HTML e URLs legadas podiam usar protocolos inesperados. | Campos de nome, mídia e link chegavam aos templates de banner e administração. | URLs novas passaram a exigir HTTPS no servidor; textos e URLs legados são escapados ou validados antes da renderização. |

## Riscos remanescentes e recomendações

| Prioridade | Risco | Impacto | Próxima ação recomendada |
|---|---|---|---|
| P0 | O multiplayer mantém salas, jogadores e timers exclusivamente em memória. A hospedagem Autoscale pode executar mais de uma instância. | Uma partida pode perder estado ou não encontrar o adversário quando conexões forem distribuídas entre instâncias. | Mudar para **Reserved Hosting** enquanto o estado permanecer em memória, ou mover salas e coordenação para banco/Redis antes de operar em Autoscale. |
| P1 | A auditoria inicial de dependências encontrou **1 crítica, 22 altas, 50 moderadas e 10 baixas**. | Após atualizar AWS SDK, `fast-xml-parser` e `@trpc/*`, o recheck ficou em **0 crítica, 18 altas, 48 moderadas e 8 baixas**. | Manter uma rotina de atualização por checkpoint; os alertas remanescentes devem ser tratados por família e testados antes de cada publicação. |
| P1 | O webhook de Mercado Pago responde `200` mesmo quando o processamento falha; os parsers globais aceitam corpos de 50 MB. | Notificações podem ser perdidas e requisições grandes podem consumir memória. | Quando os pagamentos forem ativados, persistir/encaminhar eventos antes da resposta, adotar retry idempotente e limitar o webhook a um corpo pequeno. |
| P2 | `/api/health` expõe uptime e memória, e o servidor troca de porta se a configurada estiver ocupada. | Menor exposição operacional; a troca de porta pode mascarar erro de deploy. | Reduzir o healthcheck público ao mínimo e falhar rapidamente em produção se `PORT` estiver indisponível. |

### Decisão de hospedagem

Em **14 de agosto de 2026**, o usuário decidiu manter o modo **Autoscale**. Portanto, o risco de salas e timers em memória permanece aceito para a operação atual. Caso o volume cresça ou ocorram sintomas de partidas não encontradas, perda de estado ou reconexões inconsistentes, a prioridade deve ser migrar para Reserved Hosting ou externalizar a coordenação de salas.

## Observações de regras

A análise inicial levantou a hipótese de manilhas dependentes da vira. Isso **não é um defeito confirmado** neste projeto: o motor usa as quatro manilhas fixas do Truco Gaúcho. A propriedade `vira` permanece no estado e na documentação interna, mas não participa da força das cartas; recomenda-se apenas esclarecer esse comentário para evitar manutenção equivocada.

A desistência (`fold`) também pode ser acionada fora do turno. Isso foi revisado como **regra deliberada**: o Socket.IO deriva o papel a partir do socket vinculado à sala, portanto um jogador só pode desistir da própria mão; o motor permite a ação a qualquer momento da mão ativa, comportamento compatível com o botão de correr do jogo.

## Limites desta execução

O Mercado Pago permaneceu desabilitado por solicitação do usuário, portanto não foram feitos pagamentos reais nem callbacks autenticados de produção. O envio de e-mail de recuperação não foi disparado contra endereços reais. Não houve teste de carga, observabilidade distribuída ou validação em múltiplas instâncias Autoscale.
