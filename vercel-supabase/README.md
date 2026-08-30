# Versao Supabase do Mapa RH

Esta pasta e uma versao separada da atual. A versao com password continua em `vercel-protegido/`.

## Objetivo

- Admin ve e edita todos os colaboradores.
- Gestor de equipa ve apenas o proprio registo e os colaboradores em que `chefeId` aponta para ele.
- A protecao real fica no Supabase com Row Level Security.

## Ativar

1. Criar projeto no Supabase.
2. Abrir o SQL Editor do Supabase e correr `../supabase/schema.sql`.
3. No Vercel, criar um projeto novo apontado para esta pasta ou configurar Root Directory como `vercel-supabase`.
4. Nas Environment Variables do Vercel, adicionar:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (apenas variável de servidor, necessária para `/api/create-user`)
5. Criar utilizadores no Supabase Auth.
6. Criar perfis na tabela `user_profiles`.

Exemplo para o admin:

```sql
insert into public.user_profiles (user_id, role, person_id, display_name)
values ('UUID_DO_USER_AUTH', 'admin', null, 'Goncalo');
```

Exemplo para gestor:

```sql
insert into public.user_profiles (user_id, role, person_id, display_name)
values ('UUID_DO_USER_AUTH', 'gestor', 'ID_DO_COLABORADOR_GESTOR', 'Nome do gestor');
```

## Migrar os dados atuais

Instalar dependencias uma vez:

```powershell
npm install @supabase/supabase-js
```

Depois correr:

```powershell
$env:SUPABASE_URL="https://..."
$env:SUPABASE_SERVICE_ROLE_KEY="..."
node supabase/migrate-json-to-supabase.js mapa-coordenacao-2026.json
```

Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no browser, HTML ou repositório. Na Vercel, deve existir apenas como variável de ambiente secreta das funções de servidor.
