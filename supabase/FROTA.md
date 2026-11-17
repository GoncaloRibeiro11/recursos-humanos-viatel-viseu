# Frota RH

Instalacao: executar `migrations/20261117_fleet.sql` no projeto RH. A migracao
cria apenas tabelas, funcoes e politicas de frota; nao atualiza colaboradores,
equipas, ferias ou assiduidade. Pode ser repetida sem apagar o historico.

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

Os itens da inspecao comecam por verificar. Aplicar um estado a itens vazios e
uma acao explicita do utilizador. Mau exige justificacao. Assinaturas sao
opcionais, manuscritas no ecra, ou recolhidas em papel e anexadas depois; PDF
sem todas as assinaturas e identificado como Por assinar.

## Modelo e testes

O original preservado esta em `vercel-supabase/assets/fleet/modri-94-01-v1.pdf`.
O desenho da pagina 2 e servido apenas a administradores autenticados. Notas
extensas criam paginas de continuacao, sem cortar informacao.

`npm test`; `node scripts/test-fleet-sql.cjs` com PGLITE_MODULE;
`node scripts/test-fleet-browser.cjs` com PLAYWRIGHT_MODULE e PGLITE_MODULE.
Estes testes utilizam apenas bases temporarias e colaboradores ficticios.
