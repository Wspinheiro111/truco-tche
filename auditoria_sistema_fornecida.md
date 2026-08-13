# Relatório de Auditoria do Sistema — Truco Tchê

**Autor:** Manus AI  
**Data:** 2026-05-22  
**Escopo:** Mapeamento de rotas, auditoria de UI, análise de estabilidade e plano de correções prioritárias.

---

## 1. Mapeamento de Rotas e Endpoints

O sistema é construído sobre uma arquitetura híbrida: um back-end Express com procedimentos tRPC (`/api/trpc`), servidores WebSocket dedicados (Socket.io em `/api/socketio`) e um front-end Single Page Application altamente modularizado em `client/index.html`, complementado por componentes React em `client/src/`.

### Endpoints tRPC Principais (`server/routers.ts`)
- **`auth.*`**: Gerenciamento de sessão, login via Manus OAuth e logout.
- **`localAuth.*`**: Sistema de autenticação local (login, cadastro, recuperação de PIN e vínculo com Google).
- **`pilas.*`**: Gestão da moeda virtual e integração com pagamentos do Mercado Pago.
- **`online.*`**: Salas, matchmaking e estatísticas de partidas online.
- **`admin.*`**: Painel administrativo, monitoramento de métricas e saúde do sistema (`adminProcedure`).
- **`tournament.*`**: Gestão de torneios, chaves e participantes.
- **`sponsor.*`**: Gestão de patrocinadores e banners.

### Rotas de Front-End e Telas (`client/index.html`)
- **`home`**: Menu principal com atalhos para os modos de jogo, perfil e configurações.
- **`tutorial-scr`** & **`rules-scr`**: Telas de instrução detalhada e regras oficiais do Truco Gaúcho.
- **`ranking-scr`** & **`stats-scr`**: Placar de líderes e estatísticas do jogador.
- **`tournament-scr`** & **`tournament-bracket`**: Visualização e gerenciamento de campeonatos.
- **`online-lobby`** & **`online-game`**: Telas dedicadas ao modo multijogador em tempo real via Socket.io.

---

## 2. Auditoria de Componentes e Interface (UI/UX)

A varredura dos elementos interativos revelou alta consistência visual e boa cobertura de eventos nos fluxos principais de jogo vs IA e autenticação local. No entanto, foram identificados pontos de atenção na camada de interatividade online:

| Componente / Elemento | Estado Atual | Diagnóstico / Observação |
| :--- | :--- | :--- |
| **Botão "Jogar Online"** | Funcional com ressalvas | Requer tratamento robusto contra sobrescrita de escopo global `io` por scripts de terceiros (já mitigado via `_sioFn`). |
| **Modais de Autenticação (`#m-auth`)** | Totalmente operacionais | Suportam abas de login, cadastro, recuperação de PIN e estado logado. |
| **Formulários de Torneios** | Parcialmente integrados | Validação de campos de criação de torneios depende de preenchimento manual rigoroso. |

---

## 3. Análise de Estabilidade e Travamentos

A análise estática e a execução de testes automatizados (`102/103` testes passando com sucesso em ambiente isolado) demonstram robustez geral, destacando-se:

- **Gerenciamento de Memória e Listeners**: O Socket.io implementa limpezas adequadas de salas e timeouts de turno (30 segundos com auto-fold).
- **Tratamento de Conexão**: O uso de `typeof` checks defensivos nas propriedades globais de usuário (`AUTH.user`) evita quebras de script (ReferenceError).
- **Ponto de Alerta**: Testes automatizados dependentes de chamadas externas de API (como a validação de credenciais do Mercado Pago) podem sofrer timeouts if the network environment is restricted (`mercadopago credential validation` timeout após 5s).

---

## 4. Plano de Correções e Priorização

Para garantir estabilidade em produção e prevenir falhas de experiência do usuário, recomenda-se a seguinte matriz de prioridades:

| Prioridade | Componente / Módulo | Ação Recomendada | Impacto Esperado |
| :--- | :--- | :--- | :--- |
| **Alta** | Socket.io / Conexão Global | Garantir que o cache de CDN da plataforma reflita imediatamente correções de escopo de socket (`window._sioFn`). | Eliminação definitiva de falhas ao iniciar partidas online em produção. |
| **Média** | Testes de Integração (Mercado Pago) | Adicionar mocks robustos nos testes de integração de pagamento para evitar timeouts em ambientes sem conectividade externa. | Estabilidade na execução de pipelines de CI/CD. |
| **Baixa** | Painel de Torneios | Implementar feedback visual mais claro (toasts/modais) ao submeter formulários de criação de torneios. | Melhoria incremental na experiência de usuário (UX). |

---
*Relatório gerado autonomamente por Manus AI.*
