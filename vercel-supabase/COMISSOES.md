# Comissões no portal RH

Página: `/comissoes.html`, com o mesmo acesso Supabase do portal.

A consulta usa o modelo visual dos históricos existentes: ano, mês/acumulado, pessoa, evolução mensal, composição, produção, acertos e clientes/serviços. Os relatórios são montados a partir dos pagamentos autorizados pelo Supabase, dentro de um painel isolado que não pode ler a sessão do portal. O HTML/CSS de referência foi separado dos dados e do código embutidos dos ficheiros do OneDrive; nenhum histórico privado é colocado em `public/`.

## Instalação

1. Executar `supabase/migrations/20261124_commissions.sql` e depois `supabase/migrations/20261126_commissions_permissions.sql` na base do portal. A segunda migração restringe contas de vendedor às comissões, sem alterar pagamentos ou os acessos históricos dos gestores.
2. Publicar `vercel-supabase` no projeto Vercel existente.
3. Preparar os dados privados, fora deste repositório:

   `python scripts/prepare-commissions.py MAPAS_ROOT OUTPUT_JSON`

4. Como administrador, abrir Comissões → Importar mapas e associar acessos.
5. Selecionar o JSON e confirmar explicitamente as correspondências entre NIF do mapa e pessoa RH. Não se fazem associações por semelhança de nomes.
6. Importar. Repetir substitui o mesmo pagamento (mês + NIF), sem duplicá-lo. Uma falha a meio fica indicada e pode ser repetida.

## Acessos

- Administrador: todos os pagamentos e gestão das associações.
- Gestor: pagamentos pessoais e dos meses cujo chefe no mapa tem o seu NIF.
- Vendedor: apenas o seu histórico pessoal, mesmo que mude de equipa.
- Sem correspondência confirmada: não há acesso pessoal; só administrador.
- A exportação HTML mantém a consulta interativa, contém uma única pessoa e apenas os meses autorizados, sem os acumulados em memória de outras pessoas. O CSV respeita os filtros do detalhe.
- Os dados privados nunca devem ser colocados na pasta `public`, Git ou anexados a uma publicação Vercel.

As contas de vendedor são criadas pelo administrador no modal de acessos do RH. Uma associação de NIF, por si só, não cria uma conta nem envia mensagens.

Qualquer conta autenticada pode usar **Alterar password** na página de Comissões, mesmo quando ainda não tem pagamentos. A alteração aplica-se à própria conta Supabase e exige confirmação e pelo menos 12 caracteres.

## Atualização mensal

Como administrador, usar **Sincronizar pagamentos**, escolher a pasta mensal do OneDrive (ou a pasta principal) e conferir os meses selecionados. O navegador lê os Excel localmente num worker; os ficheiros originais não são modificados nem enviados para um conversor externo. O par de ficheiros deve ter PAGAMENTOS / DETALHES, mês e ano nos nomes.

Os meses posteriores ao último mês importado ficam selecionados. Meses anteriores e existentes ficam desmarcados. Para uma correção, selecionar explicitamente o mês existente; a gravação pede uma segunda confirmação antes de substituir pagamentos com o mesmo mês e NIF. Nunca elimina os pagamentos ausentes do ficheiro nem altera outros meses. Pode repetir uma importação interrompida sem duplicar pagamentos; depois de recarregar a página, deve selecionar esse mês para completar a repetição.

Cada mês é enviado num único `upsert`, em vez de lotes de 20 pessoas, para beneficiar da transação única do PostgREST. Uma importação de vários meses pode concluir alguns e falhar noutro; os meses já concluídos mantêm-se e a repetição é idempotente. O tratamento transacional do pedido segue a [documentação PostgREST](https://docs.postgrest.org/en/v12/references/transactions.html).

A conferência apresenta mês, total, número de pagamentos e substituições. Novos NIF não recebem acesso por semelhança de nomes. As associações existentes mantêm-se; qualquer nova associação exige escolha explícita. A coordenação só é deduzida quando os NIF já conhecidos apontam para uma única coordenação; nos restantes casos é necessário escolhê-la. As comissões de chefias anteriores usam a equipa histórica por NIF, não a equipa atual do vendedor.

O leitor suporta o formato mensal validado nos onze mapas de 2026 e o mesmo formato em anos seguintes. Cabeçalhos diferentes, pares incompletos/duplicados, totais em falta, erros nas células de pagamento e rubricas que não conciliam bloqueiam a gravação. Não recalcula fórmulas: usa os resultados guardados no Excel. Erros nos indicadores de produção permanecem visíveis, VP em falta não se torna zero e não se distribuem comissões de chefia pelo coordenador ou pela gestora. Os formatos antigos de 2025 mantêm a importação de histórico JSON preparada pela rotina existente.

A importação JSON continua disponível para o histórico inicial. `manifest.json` não é um ficheiro de pagamentos e é rejeitado. O botão Atualizar apenas relê o servidor. A sincronização da pasta só ocorre quando o administrador a inicia; não existe acesso permanente ao OneDrive nem monitorização em segundo plano. A pesquisa de relatórios ignora diferenças de acentos e permite localizar nomes completos.

## Verificação

`node --test scripts/test-commissions.cjs`

`node scripts/test-commissions-sql.cjs`

`node scripts/test-commissions-browser.cjs`

`node --test scripts/test-commission-excel.mjs`

Conferência opcional com os originais privados, sem gerar ficheiros nem modificar os mapas:

`node scripts/test-commissions-source.cjs MAPAS_ROOT JSON_VALIDADO [YYYY-MM-01]`

Os testes verificam permissões efetivas no PostgreSQL, mudanças de equipa, bloqueio dos acessos RH para vendedores (incluindo contas associadas a chefes), preservação dos acessos dos gestores, rubricas numéricas, dados de outra pessoa e contagem de créditos VP. O teste de navegador usa contas, pagamentos e passwords fictícios, sem aceder à produção.

O teste do relatório verifica também ano, mês, acumulado, filtros por serviço/valor, VP sem duplicação da linha de origem, exportação HTML interativa e pessoal, bloqueio do acesso à sessão pelo painel e comportamento em computador/telemóvel. Usa a política CSP de produção, exceto o upgrade HTTPS que não se aplica ao servidor HTTP local.
