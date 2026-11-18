# Acompanhamento Comercial OOP

## Estado e limites

Desenvolvimento na branch `codex/acompanhamento-comercial-oop`, a partir de
`ac1bbcc73ca29de80a47b7853c638b7c2710463f`.
Nao publicar, fazer push com Preview automatica, instalar SQL em producao ou
alterar variaveis remotas antes da aprovacao expressa do responsavel.

## Analise da integracao

O RH usa HTML/JavaScript, bundles esbuild, Supabase Auth e perfis `admin`/`gestor`.
Os colaboradores sao `rh_persons`; o historico de atribuicoes tem intervalos
`[valid_from, valid_to)` em `rh_assignment_history`. O codigo interno `vendedor`
continua a representar o Gestor Comercial. Nao se renomeiam codigos existentes.

O prototipo `Registo_OOP_Funil_Comercial.html` serve de referencia funcional,
nao de fonte de colaboradores, autenticacao ou armazenamento. O novo modulo nao
usa a gravacao integral do estado RH nem interfere na sua fila de sincronizacao.

## Plano e implementacao

1. Reutilizar sessao/perfil e identidade RH sem novos utilizadores ou vendedores.
2. Criar tabelas OOP aditivas, RLS e RPCs com validacao e revisoes atomicas.
3. Integrar formulario, fila local por conta e protecao contra conflitos.
4. Integrar analises de coordenacao, equipa, vendedor e planos de treino.
5. Testar regras puras, PostgreSQL/RLS e navegador com dados ficticios.
6. Validar com o responsavel e so depois autorizar migracao e deployment.

Os passos 1-5 estao implementados nesta branch. A aprovacao e publicacao sao
etapas separadas, ainda nao realizadas. A base real nao foi migrada.

Verificacao local: build, 76 testes unitarios/regressao, suite SQL com RLS,
transferencias, falsificacao de autor, idempotencia, conflitos, paginacao e
reinstalacao; navegador com formulario real, gravacao SQL, rascunhos, revisao
concorrente, treino e reenvio apos falha de rede. Capturas a 1440, 390 e 320 px,
temas claro/escuro, sem erros JavaScript nem pedidos externos. Estes testes nao
substituem a futura validacao do projeto Supabase/Vercel isolado.

## Dados e permissoes

- `rh_oop_contacts`: contacto e observacao, com vendedor/CE na data, autor,
  resultado, sete etapas e dados objetivos sem identificacao do cliente.
- `rh_oop_actions`: compromissos de seguimento e planos de treino, estado,
  revisao prevista, desfecho e ligacao ao contacto de evidencia.
- `rh_oop_revisions`: antes/depois, motivo, autor e data; sem eliminacao pelo UI.
- `rh_oop_requests`: livro privado de pedidos para reenvio idempotente.

O administrador le todas as equipas. Um gestor ativo com perfil ligado ao RH le
os contactos da sua equipa atual (incluindo o historico comercial anterior) e
os contactos atribuidos a si na data. Nao le os contactos posteriores a uma
transferencia para outro CE. As outras permissoes RH permanecem inalteradas.

O CE apenas regista contactos da sua equipa atual quando era tambem o CE na
data observada. So corrige/anula os seus contactos nessa equipa; os anteriores
de outro observador sao de consulta. O novo CE pode continuar os planos de
treino do vendedor transferido. O administrador pode corrigir com justificacao.

As consultas individuais, paginas, totais e agregados respeitam a mesma RLS.
Nao ha escrita direta nas tabelas pelo cliente. O servidor deriva nomes e
equipa do RH/historico, ignora identidades fornecidas pelo browser e verifica
o UUID do autor da fila contra a sessao autenticada. Remover uma pessoa RH
nao elimina contactos OOP: conserva-se a referencia historica, nao uma segunda
pessoa no RH.

## Regras dos indicadores

- Uma conversa efetiva e contada uma vez; venda de ambos conta uma TV e uma
  Energia, nao dois contactos. Sem conversa nao entra no denominador efetivo.
- Conversao TV: contactos com TV observada / oportunidades TV ou ambas.
  Conversao Energia: equivalente para Energia. Denominador zero mostra traco.
  Sao amostras acompanhadas pelo CE, nao a producao total da rua.
- Termino da conversa e execucao da etapa sao campos distintos. Nao alcancada,
  nao observada e sem objecoes nao sao classificadas como falhas.
- Prioridades ordenam comportamentos com dificuldade/omitidos; nao inferem
  causas, competencias ou justificacoes que o CE nao observou.
- Anulacoes e TVs brutas oficiais: fonte por definir. Mostrar indisponivel,
  nunca zero. A funcao preparada exige uma coorte comum e so calcula taxa
  individual com pelo menos 4 TVs brutas validadas no periodo. Abaixo desse
  limite mostra apenas quantidades absolutas. Nao existe importacao ficticia.
- Indicadores historicos conservam o CE do contacto, mesmo depois de transferencia.
  Anulados ficam consultaveis, mas sao excluidos de todos os indicadores.
- O compromisso inicial e historico; evolucao/remarcacao faz-se na acao propria.

## Gravacao e recuperacao

Rascunhos e pedidos ficam imediatamente no localStorage separado por projeto e
utilizador. Pedido sai da fila apenas apos confirmacao do servidor. O RPC grava
contacto, revisao e acompanhamento inicial numa transacao. Uma chave de pedido
estavel evita duplicados apos falha de rede ou perda da resposta. Navigator Locks
coordena separadores quando suportado; idempotencia protege sempre o servidor.

Falha de disco/quota e assinalada: nao fechar a janela sem confirmacao. Conflitos
mantem o pedido pendente e mostram servidor/pendente para revisao explicita;
nao ha substituicao silenciosa. Logout pausa a fila e limpa o UI, mas mantem os
pendentes na conta original. Um token de outra conta nao os pode enviar.
LocalStorage nao e um backup: limpar dados do browser apaga pendentes ainda
nao enviados. Registos confirmados permanecem na base central.
O arranque da aplicacao continua a depender de uma sessao e do servico RH
disponivel; numa indisponibilidade total, os pedidos no disco aguardam o regresso
da ligacao. Nao se promete que todo o RH funcione sem rede.

## Ambiente local e testes

Na pasta `vercel-supabase`, apos `npm ci`:

```powershell
npm run build
npm test
npm run test:oop
npm run test:oop:sql
npm run test:oop:browser
npm run dev:oop
```

O teste de navegador usa Chrome instalado em Windows; em outros sistemas,
instalar o Chromium de testes com `npx playwright install chromium`.
`PGLITE_MODULE` e `PLAYWRIGHT_MODULE` permitem usar dependencias locais existentes.
`OOP_PORT` muda a porta; `OOP_OUTPUT` muda o destino das imagens dos testes.

Abrir `http://127.0.0.1:9473/oop-demo.html`. A demonstracao usa PostgreSQL em
memoria, perfis e vendedores ficticios. As ligacoes do topo simulam coordenacao
e tres CEs. Nao autentica no Supabase real, nao usa chaves reais, nao chama
APIs externas e nao pode alterar RH/Frota/Telegram. Reiniciar o servidor limpa
a base ficticia; os rascunhos locais continuam nesse browser. Nao usar dados reais.

## Preview e publicacao futura

Uma futura Preview Vercel exige `SUPABASE_URL` e `SUPABASE_ANON_KEY` explicitamente
ligados a um projeto Supabase de teste. O hostname do projeto de producao e
bloqueado na configuracao e APIs de servidor em Preview. Notificacoes Telegram
ficam desativadas em Preview. Nao herdar chaves de servico de producao.
O SQL nunca e executado pelo build.

Depois da autorizacao, validar backup e instalar `20261118_oop.sql` primeiro
num projeto de teste com `schema.sql` e `20261015_team_history.sql` existentes.
Nao reexecutar schema antigo sobre a base de producao. Validar RLS com sessoes
reais de teste antes de decidir a migracao de producao. A migracao OOP e aditiva
e reinstalavel; nao substitui dados RH. Publicar apenas o commit aprovado.
Confirmar contactos, treino, logout/relogin e contagens na instalacao final.

Em rollback, restaurar o deployment anterior e conservar as tabelas OOP e o
historico; nao executar DROP nem restaurar um snapshot antigo do RH por causa
de um problema de interface. A instalacao real e o deployment ficam pendentes
de autorizacao e de verificacao nesse ambiente.
