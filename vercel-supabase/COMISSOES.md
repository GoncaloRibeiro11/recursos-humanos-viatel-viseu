# Comissões no portal RH

Página: `/comissoes.html`, com o mesmo acesso Supabase do portal.

## Instalação

1. Executar `supabase/migrations/20261124_commissions.sql` na base do portal.
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
- A exportação HTML contém uma única pessoa e apenas os meses autorizados.
- Os dados privados nunca devem ser colocados na pasta `public`, Git ou anexados a uma publicação Vercel.

As contas de vendedor são criadas pelo administrador no modal de acessos do RH. Uma associação de NIF, por si só, não cria uma conta nem envia mensagens.

## Atualização mensal

Executar o processamento dos mapas na pasta original e voltar a preparar/importar o JSON. Rever novas pessoas e novos chefes antes de associar acessos. A equipa fica registada em cada pagamento mensal; alterações atuais de equipa não reatribuem automaticamente pagamentos antigos.

## Verificação

`node --test scripts/test-commissions.cjs`

`node scripts/test-commissions-sql.cjs`

Os testes verificam permissões efetivas no PostgreSQL, mudanças de equipa, bloqueio de escritas, dados de outra pessoa e contagem de créditos VP.
