# Funcoes e equipas com historico

## Utilizacao no site

O administrador abre o menu da fotografia e escolhe `Funcoes e equipas`.
Alterar funcao ou chefe na edicao de um colaborador tambem abre esse formulario.

1. Escolher a data de efeito.
2. Adicionar os colaboradores e indicar a nova funcao e equipa de cada um.
3. Rever o resumo e marcar a confirmacao.
4. Usar `Aplicar alteracao` para hoje/uma data passada valida ou `Agendar alteracao`
   para uma data futura. O servidor confirma a gravacao antes do sucesso.

Uma promocao e varias transferencias podem ser confirmadas em conjunto. Um gestor
promovido na mesma alteracao ja aparece como destino. As alteracoes futuras ficam
em `Agendadas`, onde podem ser canceladas. As aplicadas/canceladas ficam no
`Historico`. Para corrigir uma alteracao aplicada, criar outra alteracao datada;
nao apagar o historico. Um colaborador so pode ter uma alteracao futura pendente.

## Instalacao inicial, uma unica vez

- Publicar o frontend compativel; sem a migracao a confirmacao fica bloqueada.
- Esperar por `Guardado` nos PCs em uso e atualizar as paginas antes de criar mudancas.
- Executar `npm run prepare:team-history` em `vercel-supabase` e instalar o conteudo
  de `supabase/install-team-history.sql` no projeto Supabase correto.
- O instalador faz uma copia privada de colaboradores, ferias e assiduidade,
  preserva a organizacao atual, instala as RPCs/RLS e um unico trabalho Supabase
  Cron `rh-team-changes-due`. Tudo e instalado na mesma transacao.
- Confirmar `history_version = 2`, `scheduler_active = true`, e nenhum plano criado
  pela instalacao. Abrir o site novamente. As mudancas seguintes nao exigem SQL.
- Nunca voltar a executar o `schema.sql` original para instalar atualizacoes.

Nao ha nomes reais nem transicoes predefinidas na pagina publica ou no SQL.
A instalacao nao promove, transfere nem agenda nenhum colaborador.

## Garantias e limites

- Os intervalos sao `[inicio,fim)`. Uma mudanca a 1 de novembro mantem a equipa
  anterior ate 31 de outubro inclusive. O ponto 21-20 filtra cada dia separadamente.
- O saldo anual atribui entradas e saidas a equipa da data do evento. Transferencias
  internas nao sao contadas como entradas/saidas da empresa.
- Presencas, faltas, baixas e ferias nao sao regravadas pelas transicoes.
- As confirmacoes sao atomicas, idempotentes, exclusivas do admin e validadas
  novamente no servidor. Cada aplicacao guarda copia dos colaboradores afetados.
- O Cron verifica planos a cada minuto e usa a data `Europe/Lisbon`, mesmo sem o
  site aberto. A entrada do admin tambem processa os planos vencidos como recurso.
- Se a equipa/funcao entretanto mudou, um gestor ficou inativo ou o autor deixou
  de ser admin, o plano falha sem alteracoes parciais e fica `Requer revisao`.
- Contas de gestores so recebem assiduidade dos dias em que a pessoa lhes pertencia.
  Ferias que atravessam equipas sao recortadas no servidor. Perfis historicos minimos
  nao incluem telefone, nascimento nem outros dados pessoais atuais.
- Edicoes diretas de funcao/equipa sem o fluxo datado sao recusadas no servidor.
- A fotografia inicial preserva a organizacao no momento da instalacao. Nao inventa
  equipas antigas que nunca foram guardadas. Varias mudancas no mesmo dia mantem
  o estado final desse dia; o registo de confirmacoes guarda todas as operacoes.

## Testes

- `npm test`: gravacao imediata, saldos e modelo de historico/formulario.
- `PLAYWRIGHT_MODULE=... node scripts/test-rh-browser.cjs`: site/API simulada,
  mapas por data, privacidade dos gestores, agendar/cancelar/aplicar, rede falhada,
  persistencia apos atualizar, temas e ecras 320/390 px.
- `PGLITE_MODULE=... node scripts/test-team-history-sql.cjs`: PostgreSQL descartavel,
  permissoes, atomicidade, backups, agenda, cancelamento e falhas por dados antigos.
- Nenhum destes testes acede ao Supabase real.
