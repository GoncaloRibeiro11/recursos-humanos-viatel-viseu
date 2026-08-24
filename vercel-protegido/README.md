# Mapa RH protegido para Vercel

Esta pasta e uma versao separada para alojamento na Vercel.

- O site atual/local continua fora desta configuracao.
- Todas as rotas ficam protegidas por autenticação Basic Auth numa unica funcao Vercel.
- O utilizador padrao e `rh`.
- A password desta primeira versao fica validada por hash SHA-256 na funcao `api/index.js`.

Nesta fase simples, a Vercel serve os dados do ficheiro JSON incluido no deploy. A gravacao online persistente fica para o upgrade com Supabase.
