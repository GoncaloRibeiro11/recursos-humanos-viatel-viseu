import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export function releaseSql(){
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261118_oop.sql'),'utf8');
  if(!/^--[^\n]*\r?\nbegin;/.test(migration) || !/commit;\s*$/.test(migration))throw new Error('Unexpected migration transaction boundaries.');
  const body=migration.replace(/^--[^\n]*\r?\nbegin;\r?\n/,'').replace(/commit;\s*$/,'');
  // Snapshot and migration share one transaction: failure cannot leave a partial release.
  return `-- Analise Vendedor: guarded production installation, 2026-11-19.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='90s';
do $$ begin
  if to_regclass('public.rh_oop_contacts') is not null then raise exception 'OOP already installed; inspect before repeating this release.';end if;
  if to_regclass('public.rh_assignment_history') is null then raise exception 'Team history prerequisite missing.';end if;
end $$;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated,service_role;
create table rh_release_backups.oop_20261119_rows(table_name text not null,row_data jsonb not null);
create table rh_release_backups.oop_20261119_manifest(table_name text primary key,row_count bigint not null,digest text not null);
alter table rh_release_backups.oop_20261119_rows enable row level security;
alter table rh_release_backups.oop_20261119_manifest enable row level security;
revoke all on rh_release_backups.oop_20261119_rows,rh_release_backups.oop_20261119_manifest from public,anon,authenticated,service_role;
do $$ declare r record;begin
  for r in select tablename from pg_tables where schemaname='public' and (tablename like 'rh\\_%' escape '\\' or tablename='user_profiles') order by tablename loop
    execute format('lock table public.%I in share mode',r.tablename);
    execute format('insert into rh_release_backups.oop_20261119_rows select %L,to_jsonb(t) from public.%I t',r.tablename,r.tablename);
    insert into rh_release_backups.oop_20261119_manifest
      select r.tablename,count(*),md5(coalesce(string_agg(md5(row_data::text),'' order by md5(row_data::text)),'')) from rh_release_backups.oop_20261119_rows where table_name=r.tablename;
  end loop;
end $$;
${body}
do $$ declare r record;n bigint;d text;begin
  for r in select * from rh_release_backups.oop_20261119_manifest loop
    execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),%L order by md5(to_jsonb(t)::text)),%L)) from public.%I t','','',r.table_name) into n,d;
    if n<>r.row_count or d<>r.digest then raise exception 'Existing data changed in %, aborting release.',r.table_name;end if;
  end loop;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('rh_oop_contacts','rh_oop_actions','rh_oop_revisions','rh_oop_requests') and c.relrowsecurity)<>4 then raise exception 'OOP RLS check failed.';end if;
end $$;
commit;
select 'INSTALLED - EXISTING DATA UNCHANGED' as result,table_name,row_count,digest from rh_release_backups.oop_20261119_manifest order by table_name;
`;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const destination=process.argv[2];if(!destination)throw new Error('Pass an explicit private output SQL path.');
  fs.writeFileSync(path.resolve(destination),releaseSql());console.log('Guarded OOP release SQL generated.');
}
