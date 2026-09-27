# Truco Tchê

Jogo de **Truco Gaúcho** com partidas contra IA, multiplayer em tempo real, salas privadas, torneios, perfil de jogador, notificações PWA e mesas presenciais por QR Code.

> O projeto mantém a identidade cultural gaúcha nas regras, na nomenclatura das cartas e nos certificados de torneio.

## Sumário

- [Visão geral](#visão-geral)
- [Regras do jogo](#regras-do-jogo)
- [Modos de partida](#modos-de-partida)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Configuração](#configuração)
- [Executar em desenvolvimento](#executar-em-desenvolvimento)
- [Testes e build](#testes-e-build)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Multiplayer e recuperação](#multiplayer-e-recuperação)
- [PWA e notificações](#pwa-e-notificações)
- [Segurança](#segurança)
- [Contribuição](#contribuição)
- [Licença](#licença)

## Visão geral

O Truco Tchê possui um motor de regras compartilhado entre servidor e cliente. O servidor é autoritativo: jogadas, pedidos, pontuação e transições de fase são validados no backend antes de o novo estado ser transmitido aos jogadores.

O projeto foi estruturado para funcionar em infraestrutura stateless/autoscale. O estado necessário para recuperar uma partida é persistido no banco, enquanto o Socket.IO é usado para comunicação em tempo real entre as sessões conectadas.

## Regras do jogo

### Baralho e força das cartas

O jogo usa um baralho de 40 cartas com os seguintes valores numéricos:

- **1, 2, 3, 4, 5, 6, 7, 10, 11 e 12** de cada naipe.
- Os naipes são **Ouros, Bastos, Espadas e Copas**.
- Cartas 8 e 9 não fazem parte do baralho.
- A força é determinada pela hierarquia gaúcha implementada no motor.

A ordem de força usada pelo motor, da mais forte para a mais fraca, é:

1. 1 de Espadas
2. 1 de Bastos
3. 7 de Espadas
4. 7 de Ouros
5. 3
6. 2
7. 1 restante
8. 12
9. 11
10. 10
11. 7 restante
12. 6
13. 5
14. 4

As cartas viradas e os valores de manilha são mantidos no estado da mão para que a mesa possa exibir as informações necessárias durante a partida.

### Mão, rodadas e pontuação

- Cada jogador recebe **3 cartas**.
- Uma mão é disputada em até **3 rodadas**.
- Cada jogador joga uma carta por rodada, respeitando a vez indicada pelo servidor.
- A rodada é vencida pela carta de maior força.
- Se houver empate, a rodada é registrada como parda.
- O vencedor da primeira rodada normalmente conduz a próxima; em caso de parda, a vez retorna ao **mano da mão**.
- Quem vencer 2 rodadas vence a mão.
- Se as 3 rodadas terminarem empatadas, o **mano** vence a mão.
- Após uma mão concluída, o próximo mano é alternado.

No modo 1x1, a partida termina quando um jogador alcança **12 pontos**. A pontuação da mão depende do nível de Truco aceito.

### Truco

O pedido de Truco aumenta o valor da mão. Os níveis disponíveis são:

| Nível | Nome | Valor da mão |
|---|---|---:|
| 1 | Normal | 1 ponto |
| 2 | Truco | 2 pontos |
| 3 | Retruco | 3 pontos |
| 4 | Vale Quatro | 4 pontos |

Regras principais:

- O jogador só pode pedir quando for sua vez.
- O adversário pode aceitar ou recusar.
- Ao recusar, o desafiador recebe a pontuação correspondente à recusa, em vez do valor cheio do nível solicitado.
- Um jogador não pode aumentar o próprio Truco consecutivamente.
- O servidor bloqueia pedidos inválidos, fora da vez ou acima de Vale Quatro.

### Envido

O Envido é calculado a partir dos valores de Envido das cartas:

- Cartas 10, 11 e 12 valem **0** para Envido.
- Cartas de 1 a 7 mantêm seu valor numérico.
- Duas cartas do mesmo naipe somam **20 + os valores das duas cartas**.
- Se não houver duas cartas do mesmo naipe, vale a maior carta individual.
- O motor também calcula quando o jogador possui Flor.

Os pedidos disponíveis incluem:

- Envido
- Envido de resposta
- Real Envido
- Falta Envido

O Envido deve ser chamado antes que a primeira carta da mão seja jogada. Depois que qualquer jogador jogar sua primeira carta, o motor bloqueia novos pedidos de Envido. A pontuação é comparada entre os jogadores e, em caso de empate, o mano leva a disputa. Se o pedido for recusado, são aplicados os pontos de recusa previstos pela cadeia de pedidos.

### Flor

- Flor ocorre quando as 3 cartas do jogador são do mesmo naipe.
- A pontuação base é **20 + os valores das três cartas**.
- O pedido de Flor deve acontecer antes da primeira carta da mão ser jogada.
- A cadeia permite Flor, Contra-Flor e Contra-Flor ao Resto.
- O jogador sem Flor não pode responder como se tivesse Flor.
- Em caso de empate, o mano vence a disputa.

### Tempo de jogada

Cada turno possui um limite padrão de **30 segundos**. O estado registra quando o turno começou e o servidor rejeita uma jogada expirada. Isso evita que uma partida fique travada indefinidamente por um jogador ausente.

## Modos de partida

### Mano a mano — 1x1

- Dois jogadores, um contra o outro.
- Alvo padrão: 12 pontos.
- Cada jogador recebe uma mão privada de 3 cartas.
- É o modo principal para partidas rápidas e torneios eliminatórios.

### Duplas — 2x2

- Quatro jogadores divididos em duas equipes.
- Os assentos alternam entre as equipes A e B.
- Cada participante recebe sua própria mão privada.
- A mão possui quatro cartas na mesa, uma por jogador, antes da resolução da rodada.
- Alvo padrão: 24 pontos.
- Envido e Flor consideram o melhor resultado disponível dentro da equipe.

### Trios — 3x3

- Seis jogadores divididos em duas equipes de três.
- Os assentos alternam entre as equipes A e B.
- Cada participante recebe sua própria mão privada.
- A rodada é resolvida depois que os seis jogadores jogam uma carta.
- Alvo padrão: 24 pontos.
- Envido e Flor são resolvidos usando o melhor resultado da equipe.

## Funcionalidades

- Partidas offline contra IA.
- Multiplayer em tempo real com Socket.IO.
- Lobby de salas ativas com filtros.
- Salas privadas e convites entre amigos.
- Lista de amigos e convites diretos.
- Contador de jogadores online.
- Presença na mesa: online, reconectando e desconectado.
- Reconexão com recuperação do estado atual da partida.
- Torneios 1x1 com número par de vagas, sorteio e chave eliminatória.
- Início manual do torneio pelo organizador.
- Edição e cancelamento antes do sorteio.
- Duplicação de torneios encerrados com pré-visualização.
- Prêmio e horário configuráveis pelo organizador.
- Página pública da chave e do progresso do torneio.
- Certificado PDF gauchesco para o campeão.
- Perfil com estatísticas, histórico e títulos conquistados.
- PWA instalável em dispositivos compatíveis.
- Web Push para lembretes de torneios.
- Central de notificações no aplicativo.
- Mesas presenciais 1x1, 2x2 e 3x3 por QR Code.
- Cartas carregadas sob demanda a partir de armazenamento externo, com cache local.

## Arquitetura

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, Lucide |
| Backend | Node.js, Express, tRPC 11 |
| Tempo real | Socket.IO |
| Banco | MySQL/TiDB com Drizzle ORM |
| Autenticação | Sessão/JWT via cookies e OAuth Manus |
| Armazenamento | Storage compatível com S3 |
| PDF | pdf-lib |
| PWA | Web App Manifest, Service Worker e Web Push |
| Testes | Vitest e smokes de multiplayer |

O motor de regras fica em `shared/` para permitir validação consistente no servidor e no cliente:

- `shared/gameEngine.ts`: regras do modo 1x1.
- `shared/teamGameEngine.ts`: regras de duplas e trios.

## Requisitos

- Node.js 20 ou superior.
- pnpm 10 ou superior.
- MySQL ou TiDB acessível pela aplicação.
- Credenciais das integrações Manus quando o ambiente exigir autenticação, armazenamento ou notificações.
- Para Web Push em produção: chaves VAPID configuradas.

## Configuração

1. Clone o repositório:

   ```bash
   git clone https://github.com/Wspinheiro111/truco-tche.git
   cd truco-tche
   ```

2. Instale as dependências:

   ```bash
   pnpm install
   ```

3. Crie um arquivo `.env` na raiz. O arquivo não deve ser commitado:

   ```env
   NODE_ENV=development
   PORT=3000

   # Banco MySQL/TiDB
   DATABASE_URL=mysql://usuario:senha@localhost:3306/truco_tche

   # Sessão e autenticação
   JWT_SECRET=troque-por-um-segredo-longo-e-aleatorio

   # OAuth/Manus, quando usado pelo ambiente
   VITE_APP_ID=
   OAUTH_SERVER_URL=
   OWNER_OPEN_ID=

   # APIs internas Manus, quando usadas pelo ambiente
   BUILT_IN_FORGE_API_URL=
   BUILT_IN_FORGE_API_KEY=

   # Web Push, quando habilitado
   VAPID_PUBLIC_KEY=
   VAPID_PRIVATE_KEY=
   VAPID_SUBJECT=mailto:seu-email@example.com
   ```

   O mínimo necessário para comandos de banco é `DATABASE_URL`. Para executar o servidor local com autenticação, configure também `JWT_SECRET` e as variáveis do ambiente Manus utilizadas pelo projeto.

4. Gere e aplique o schema do banco:

   ```bash
   pnpm db:push
   ```

   Esse script executa `drizzle-kit generate` e `drizzle-kit migrate`.

## Executar em desenvolvimento

Inicie o servidor de desenvolvimento:

```bash
pnpm dev
```

O servidor usa a porta `3000` por padrão, ou a porta definida em `PORT`. Abra no navegador:

```text
http://localhost:3000
```

O fluxo básico de teste é:

1. Abrir o jogo em uma aba.
2. Criar ou entrar em uma sala.
3. Abrir a mesma sala em outra aba ou dispositivo.
4. Confirmar que ambos os jogadores aparecem na mesa.
5. Jogar cartas alternadamente.
6. Testar Truco, Envido e Flor dentro das janelas permitidas.
7. Atualizar ou reconectar uma aba para verificar a recuperação do estado.

Para testar o modo presencial, crie uma mesa QR Code, escolha 1x1, 2x2 ou 3x3 e use o convite gerado nos dispositivos dos participantes.

## Testes e build

Executar a suíte automatizada:

```bash
pnpm test
```

Executar a verificação TypeScript:

```bash
pnpm check
```

Gerar a versão de produção:

```bash
pnpm build
```

Iniciar a versão compilada:

```bash
pnpm start
```

A build gera os arquivos frontend em `dist/public` e o bundle do servidor em `dist`.

## Estrutura do projeto

```text
client/
  index.html                 Shell HTML mínimo do Vite
  src/
    App.tsx                  Entrada principal do aplicativo
    game/                    Bootstrap, socket, cartas e runtime do jogo
    components/              Componentes reutilizáveis e UI
    pages/                   Páginas de perfil, torneio e administração
    lib/trpc.ts              Cliente tRPC

server/
  _core/                     Inicialização, autenticação e infraestrutura
  db.ts                      Acesso persistente ao banco
  routers.ts                 Procedimentos tRPC
  socketServer.ts             Eventos e salas Socket.IO

shared/
  gameEngine.ts              Motor 1x1
  teamGameEngine.ts          Motor 2x2 e 3x3
  types.ts                   Tipos compartilhados

drizzle/
  schema.ts                  Schema Drizzle
  migrations/                Migrações geradas

scripts/                     Smokes e utilitários de validação
```

## Multiplayer e recuperação

O Socket.IO usa o caminho `/api/socketio`. O servidor valida a identidade do jogador antes de aceitar eventos da sala e impede que uma sessão troque indevidamente de jogador ou de sala.

Para suportar execução em múltiplas instâncias:

- O banco é a fonte persistente para salas, torneios e snapshots relevantes.
- Eventos de atualização podem invalidar o lobby para que os clientes consultem o estado persistido.
- O estado atual é reenviado na reconexão.
- Marcadores persistentes de presença e reconexão evitam que uma instância trate um jogador como definitivamente desconectado enquanto outra ainda o possui conectado.
- O código não depende de memória local como única fonte de verdade.

## PWA e notificações

Em um navegador compatível, o aplicativo pode ser instalado como PWA. Depois de conceder permissão, o dispositivo pode receber lembretes de torneios, incluindo avisos próximos ao horário de início.

O usuário controla a permissão de notificações no próprio dispositivo. A entrega depende do suporte do navegador, da conexão e da configuração de Web Push do ambiente.

## Segurança

- Nunca publique `.env`, tokens, senhas ou chaves privadas.
- Use um `JWT_SECRET` forte e exclusivo por ambiente.
- Mantenha o banco protegido por credenciais com o menor privilégio necessário.
- As jogadas devem ser validadas pelo servidor; o cliente não é uma fonte confiável.
- Webhooks e integrações externas devem usar seus segredos próprios e validação de assinatura quando habilitados.
- O repositório é público para consulta do código, mas segredos de infraestrutura continuam fora do Git.

## Contribuição

1. Crie uma branch curta a partir de `main`:

   ```bash
   git checkout -b feature/minha-melhoria
   ```

2. Faça uma alteração focada.
3. Execute `pnpm check` e `pnpm test`.
4. Verifique se nenhum segredo ou arquivo `.env` foi incluído.
5. Abra um pull request descrevendo o problema, a solução e os testes executados.

## Licença

Este projeto está distribuído sob a licença **MIT**. Consulte o arquivo `package.json` e os avisos de terceiros para obter informações adicionais sobre dependências.
