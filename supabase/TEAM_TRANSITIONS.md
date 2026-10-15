# Transicoes de equipa com historico

Estado desta entrega: preparacao local. Nao publicar, executar a migracao ou
aplicar a transicao sem confirmar a data e obter autorizacao para a ativacao.
Nao existe cron, agendamento, mudanca automatica nem botao de ativacao nesta versao.

O rascunho com os nomes indicados fica fora do repositorio, num ficheiro privado
`recovery/team-transition.backup-diogo.json` do workspace principal. A data e nula
e `automaticActivation` e falso. Nomes reais nao sao embutidos na pagina publica.

## Preparacao e ativacao futura

1. Confirmar a data efetiva, o gestor de origem, a promocao e os colaboradores.
2. Esperar por `Guardado` nos PCs em uso e preservar uma copia da base antes da
   instalacao. Publicar o frontend compativel, ainda sem mudar as equipas.
3. Instalar `migrations/20261015_team_history.sql` numa transacao. Esta etapa
   cria a fotografia inicial da organizacao e as permissoes por data; nao promove
   nem transfere pessoas. Atualizar as paginas dos dois PCs apos a instalacao.
4. Importar o rascunho pelo menu de perfil do admin, em `Preparar transicao de equipa`.
   O ecra so pre-visualiza e exporta JSON. Guardar nao escreve na base.
5. No dia autorizado, validar novamente o rascunho com dados atuais atraves de
   `RhTeams.prepareDraft`. `activationPayload` exige data confirmada, dia atingido
   e um UUID de confirmacao. Usar a sessao admin autenticada para a RPC
   `apply_rh_team_transition`; nunca uma chave de servico no navegador.
   A confirmacao final e uma operacao administrativa separada, nao exposta pelo
   ecra de preparacao. O SQL Editor sem sessao RH autenticada tambem e recusado.
6. Recarregar e verificar os periodos anteriores, posteriores e o ponto 21-20.
   Para uma repeticao por falha de rede, reutilizar o mesmo UUID e payload.

## Garantias e limites

- Os intervalos usam inicio inclusivo e fim exclusivo. O dia da mudanca pertence
  a equipa nova; as datas anteriores mantem a equipa e funcao anteriores.
- A confirmacao bloqueia os registos afetados e valida os valores de origem.
  Se qualquer membro mudou entretanto, toda a operacao e recusada. Falhas a meio
  tambem revertem todas as alteracoes e o respetivo historico.
- Presencas, faltas, baixas e ferias nao sao regravadas pela transicao.
- Alteracoes posteriores de funcao ou chefe tambem sao capturadas pelo trigger.
- O historico nao e derivado do log incompleto de edicoes. A fotografia inicial
  preserva a organizacao atual antes da primeira transicao confirmada; nao
  recupera equipas antigas que nunca foram guardadas.
- Gestores leem assiduidade por dia. Ferias que atravessam uma transferencia sao
  recortadas no servidor. Um antigo gestor recebe apenas o perfil historico minimo
  autorizado, nao o perfil pessoal atual fora da sua equipa.
- O frontend antigo nao oferece estas garantias de apresentacao. Publicar a
  versao compativel e atualizar os PCs faz parte da ativacao futura.

## Verificacao local

`npm test` verifica gravacao imediata e o modelo de historico.

`PLAYWRIGHT_MODULE` pode apontar para a instalacao de Playwright disponivel no
ambiente. Executar `node scripts/test-rh-browser.cjs` em `vercel-supabase` verifica
rascunho sem escrita, papeis por data, ponto misto, impressoes e acesso dos gestores.

O teste SQL usa PostgreSQL em memoria com `@electric-sql/pglite@0.5.10`, instalado
fora das dependencias de producao. Definir `PGLITE_MODULE` para esse modulo e
executar `node scripts/test-team-history-sql.cjs`. Nao acede ao Supabase real.
