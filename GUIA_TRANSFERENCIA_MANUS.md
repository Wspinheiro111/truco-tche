# Pacote de transferência — Truco Tchê

## Conteúdo

Este pacote contém a cópia do código-fonte do Truco Tchê, testes, migrações Drizzle, documentação de regras, auditorias, `todo.md` e o contexto técnico para continuar o desenvolvimento em outra conta Manus.

A origem do código é o commit `52b5a944`, do projeto original `truco-tche`. O diretório de desenvolvimento usado para preparar este pacote foi `/home/ubuntu/truco-tche-dev`.

## O que foi excluído por segurança

Não foram incluídos `node_modules`, `dist`, logs de desenvolvimento, `.project-config.json`, `.env`, chaves privadas, tokens, segredos de integração, credenciais do banco, configuração interna do projeto Manus nem o diretório `.git` com o remoto interno da conta original. Esses itens não devem ser transferidos em um arquivo ZIP.

## Como importar na outra conta Manus

Na nova conta, crie uma tarefa/projeto de desenvolvimento e envie este ZIP. Peça ao agente para extrair o código, preservar a estrutura existente e ler primeiro `CONTEXTO_COPIA.md`, `auditoria_sistema_fornecida.md`, `auditoria_sistema.md`, `regras_truco_tche.md` e `todo.md`.

Depois da importação, execute a instalação das dependências com `pnpm install`, valide o projeto com `pnpm test` e execute o build com `pnpm build`. A nova conta deverá configurar novamente os secrets por meio do painel de Secrets, especialmente `DATABASE_URL`, `JWT_SECRET`, credenciais OAuth, chaves do Forge, Mercado Pago e variáveis de analytics. Os valores não estão neste pacote.

## Atenção ao banco e à publicação

O código não transfere automaticamente o banco MySQL/TiDB, dados de usuários, saldos, compras, histórico de partidas, torneios, patrocinadores, domínios ou checkpoints. Antes de apontar a nova conta para um banco existente, faça um backup e confirme a intenção, pois o banco não deve ser tratado como parte do ZIP.

A nova conta deve criar seu próprio checkpoint antes de publicar. O domínio `trucotche.manus.space` e o domínio alternativo da conta original não são reassociados automaticamente por este pacote.

## Prompt recomendado para a nova tarefa

> Continue o desenvolvimento do Truco Tchê a partir deste pacote. Leia `CONTEXTO_COPIA.md`, `todo.md`, `auditoria_sistema_fornecida.md`, `auditoria_sistema.md` e `regras_truco_tche.md` antes de alterar qualquer arquivo. Preserve o modo offline, as regras e as cartas existentes. Não substitua o sistema por outro projeto. Reconfigure secrets somente pelo painel apropriado, execute os testes antes de modificar a lógica e registre toda mudança no `todo.md`.

## Verificação

Consulte `INVENTARIO_TRANSFERENCIA.txt` para a lista de arquivos incluídos e `SHA256SUMS_TRANSFERENCIA.txt` para confirmar a integridade depois do download.
