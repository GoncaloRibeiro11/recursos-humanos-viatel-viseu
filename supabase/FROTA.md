# Frota RH

Instalacao: executar `migrations/20261117_fleet.sql` no projeto RH. A migracao
cria apenas tabelas, funcoes e politicas de frota; nao atualiza colaboradores,
equipas, ferias ou assiduidade. Pode ser repetida sem apagar o historico.
Depois executar `migrations/20261117_fleet_shares.sql` para as ligacoes privadas.

## Acesso e dados

- Gestao inicialmente exclusiva do administrador RH, verificada no Postgres e
  no endpoint PDF. Os gestores nao recebem dados de frota nem documentos.
- `cartrack_number` e uma referencia textual manual, preservando zeros iniciais.
  Nao existe integracao, credencial, GPS ou chamada a Cartrack.
- `rh_fleet_vehicles`: cadastro e titular habitual.
- `rh_fleet_custody`: periodos reais [inicio, fim), nunca derivados das ferias.
- `rh_fleet_handovers`: rascunhos e snapshots confirmados/imutaveis.
- Bucket privado `rh-fleet`: fotografias, documentos assinados e PDF original.
  Nao existem politicas de UPDATE/DELETE de ficheiros para o navegador.

## Fluxo

1. Adicionar viatura e respetivo N. Cartrack.
2. Registar entrega inicial; o titular habitual sozinho nao cria uma posse real.
3. Passagem temporaria/permanente ou devolucao: data/hora de Portugal,
   quilometros, combustivel, inspecao e confirmacao explicita da entrega real.
4. Rascunhos gravam localmente a cada alteracao e no servidor com debounce;
   podem ser retomados. Confirmacoes usam bloqueio da viatura e versoes para
   impedir sobreposicoes e alteracoes vindas de separadores desatualizados.
5. Entrega confirmada fecha a posse anterior e inicia a seguinte atomicamente.
   Devolucao a empresa apenas fecha a posse. Datas futuras ficam em rascunho;
   devolucao prevista nao e devolucao efetiva.
6. `api/fleet-auto.js` gera o modelo MODRI.94/01 com os dados congelados e
   arquiva `auto-v1.pdf` sem sobrescrever. Em falha, a entrega fica guardada e o
   administrador pode repetir Auto PDF. Nao e utilizada a service-role key.

No rascunho, os campos Nome completo de quem entrega / recebe permitem indicar
os nomes para o documento sem renomear colaboradores nem mudar a posse da
viatura. Sao usados nos Dados dos Condutores, junto das assinaturas e na
pagina remota. Empresa / parque identifica a origem/destino, nao um condutor:
sem nome indicado, o campo do condutor fica vazio (ou usa o nome da assinatura
remota quando disponivel). Mudar quem recebe limpa o nome manual anterior.
Autos ja confirmados e PDFs arquivados nao sao reescritos.
Os nomes sao preenchidos automaticamente: o responsavel com entrega real tem
prioridade; sem entrega registada, uma passagem/devolucao sugere o responsavel
habitual com essa falta de registo assinalada. A entrega inicial mantem a
empresa como origem e sugere o habitual em Recebe. As sugestoes nao criam
posses nem dispensam o registo inicial para confirmar uma passagem temporaria.
Nomes indicados manualmente sao preservados; pedidos de assinatura ativos nao
recebem alteracoes automaticas aos nomes. Trocar Recebe sugere o novo nome.

Os itens da inspecao comecam por verificar. Aplicar um estado a itens vazios e
uma acao explicita do utilizador. Mau exige justificacao. Assinaturas sao
opcionais, manuscritas no ecra, ou recolhidas em papel e anexadas depois; PDF
sem todas as assinaturas e identificado como Por assinar.

## Preenchimento e assinaturas no telemovel

- No rascunho, Enviar para preencher cria uma ligacao limitada a esse auto.
  Permite completar a inspecao, quilometros, combustivel, observacoes e fotos;
  nao permite escolher outras pessoas/viaturas nem confirmar a entrega.
- Depois do preenchimento, criar uma ligacao para quem entrega/devolve e outra
  para quem recebe. Cada pessoa consulta o auto, indica o nome, desenha a sua
  assinatura com o dedo e confirma. Nao precisa de conta RH.
- As ligacoes duram 24 horas, sao cancelaveis e de utilizacao unica apos
  concluir/assinar. Quem tiver a ligacao tem acesso a esse auto: partilhar
  apenas com o destinatario correto. O token aleatorio de 256 bits fica no
  fragmento do URL e apenas o seu hash fica guardado no Postgres.
- Atualizar assinaturas no RH obtem a versao do servidor. A confirmacao final
  continua a ser exclusiva do administrador; os links nunca alteram posses.
- Pedir assinaturas externas exige ambas para confirmar. Alterar o conteudo,
  intervenientes, viatura ou fotos invalida as assinaturas dessa versao.
  Cancelar ligacoes liberta o rascunho para rever e pedir novas assinaturas.
- PDF arquivado inclui imagens das assinaturas, nome indicado, data/hora,
  identificador do registo e hash da versao assinada. E assinatura manuscrita
  em ecra, nao assinatura certificada/qualificada nem verificacao de identidade.
- Endpoints `fleet-share` (admin) e `fleet-remote` (token por auto) usam
  `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor. Nunca a colocar no HTML/JS.
  Nao existem leituras anonimas de tabelas nem ficheiros publicos no bucket.

## Modelo e testes

O original preservado esta em `vercel-supabase/assets/fleet/modri-94-01-v1.pdf`.
O desenho da pagina 2 e servido apenas a administradores autenticados. Notas
extensas criam paginas de continuacao, sem cortar informacao.

`npm test`; `node scripts/test-fleet-sql.cjs` com PGLITE_MODULE;
`node scripts/test-fleet-browser.cjs` com PLAYWRIGHT_MODULE e PGLITE_MODULE.
Estes testes utilizam apenas bases temporarias e colaboradores ficticios.

Assinaturas: `node scripts/test-fleet-shares-sql.cjs` com PGLITE_MODULE e
`node scripts/test-fleet-remote-browser.cjs` com ambos os modulos. Incluem
desenho com eventos touch em 320/390 px, duas assinaturas, recibo de utilizacao
unica, conflitos de versao, expiracao/cancelamento e PDF privado arquivado.
