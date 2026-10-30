import { readFile, writeFile } from 'node:fs/promises';

const root=new URL('../../supabase/',import.meta.url);
const files=['20261015_team_history.sql','20261030_team_changes.sql','20261030_team_changes_cron.sql'];
const parts=[];
for (const file of files){
  const sql=await readFile(new URL('migrations/'+file,root),'utf8');
  if ((sql.match(/^begin;$/gm) || []).length!==1 || (sql.match(/^commit;$/gm) || []).length!==1) throw new Error('Unexpected transaction boundary: '+file);
  parts.push(sql.replace(/^begin;$/m,'').replace(/^commit;$/m,''));
}
const backup=`create schema if not exists rh_private;
revoke all on schema rh_private from public,anon;
lock table public.rh_persons,public.rh_vacations,public.rh_attendance_records in share row exclusive mode;
create table if not exists rh_private.installation_backups (
  id text primary key, created_at timestamptz not null default now(), data jsonb not null
);
revoke all on rh_private.installation_backups from public,anon,authenticated;
insert into rh_private.installation_backups(id,data)
select 'team-history-20261030',jsonb_build_object(
  'persons',coalesce((select jsonb_agg(to_jsonb(p)) from public.rh_persons p),'[]'::jsonb),
  'vacations',coalesce((select jsonb_agg(to_jsonb(v)) from public.rh_vacations v),'[]'::jsonb),
  'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.rh_attendance_records a),'[]'::jsonb)
) on conflict(id) do nothing;`;
await writeFile(new URL('install-team-history.sql',root),`-- One-time installation: backup + history + self-service + scheduler.
-- No employee changes are created by this installation.
begin;
${backup}
${parts.join('\n')}
commit;
select public.rh_team_history_version() as history_version,
  (select count(*) from public.rh_assignment_history) as history_rows,
  (select count(*) from public.rh_team_change_plans) as change_plans,
  (select active from cron.job where jobname='rh-team-changes-due') as scheduler_active;
`);
console.log('Prepared supabase/install-team-history.sql');
