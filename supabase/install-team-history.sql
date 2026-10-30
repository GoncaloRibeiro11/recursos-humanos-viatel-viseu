-- One-time installation: backup + history + self-service + scheduler.
-- No employee changes are created by this installation.
begin;
create schema if not exists rh_private;
revoke all on schema rh_private from public,anon;
lock table public.rh_persons,public.rh_vacations,public.rh_attendance_records in share row exclusive mode;
create table if not exists rh_private.installation_backups (
  id text primary key, created_at timestamptz not null default now(), data jsonb not null
);
alter table rh_private.installation_backups enable row level security;
revoke all on rh_private.installation_backups from public,anon,authenticated;
insert into rh_private.installation_backups(id,data)
select 'team-history-20261030',jsonb_build_object(
  'persons',coalesce((select jsonb_agg(to_jsonb(p)) from public.rh_persons p),'[]'::jsonb),
  'vacations',coalesce((select jsonb_agg(to_jsonb(v)) from public.rh_vacations v),'[]'::jsonb),
  'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.rh_attendance_records a),'[]'::jsonb)
) on conflict(id) do nothing;
-- Install together with the dated-history frontend. No employee is transferred by installation.


create schema if not exists rh_private;
revoke all on schema rh_private from public, anon;
grant usage on schema rh_private to authenticated;

create table if not exists public.rh_assignment_history (
  id uuid primary key default gen_random_uuid(),
  person_id text not null references public.rh_persons(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  role_code text,
  chefe_id text,
  chefe_name text,
  person_snapshot jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  unique (person_id, valid_from),
  check (valid_to is null or valid_to > valid_from)
);
create unique index if not exists rh_assignment_one_current
  on public.rh_assignment_history(person_id) where valid_to is null;

create table if not exists public.rh_team_transition_runs (
  request_id uuid primary key,
  effective_date date not null,
  changes jsonb not null,
  changed_by uuid not null,
  before_persons jsonb not null default '[]'::jsonb,
  applied_at timestamptz not null default now()
);
alter table public.rh_assignment_history enable row level security;
alter table public.rh_team_transition_runs enable row level security;
revoke all on public.rh_assignment_history, public.rh_team_transition_runs from public, anon, authenticated;
grant select on public.rh_assignment_history, public.rh_team_transition_runs to authenticated;

create or replace function rh_private.person_snapshot(p public.rh_persons)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('name',p.name,'photo',p.data->'photo','photoMirror',p.data->'photoMirror',
    'color',p.data->'color','ativo',p.ativo,'entrada',p.entrada,'saida',p.saida,
    'empresa',p.empresa,'carga',p.carga);
$$;
revoke all on function rh_private.person_snapshot(public.rh_persons) from public, anon, authenticated;

-- The baseline preserves the current organization before the first dated change.
-- It does not invent previous transfers from an incomplete edit log.
insert into public.rh_assignment_history(person_id,valid_from,role_code,chefe_id,chefe_name,person_snapshot)
select p.id,date '0001-01-01',coalesce(nullif(p.role_code,''),p.data->>'role'),coalesce(nullif(p.chefe_id,''),p.data->>'chefeId'),m.name,rh_private.person_snapshot(p)
from public.rh_persons p left join public.rh_persons m on m.id = coalesce(nullif(p.chefe_id,''),p.data->>'chefeId')
on conflict (person_id,valid_from) do nothing;

create or replace function rh_private.capture_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  effective date;
  previous public.rh_assignment_history;
  manager_name text;
begin
  select p.name into manager_name from public.rh_persons p where p.id = coalesce(nullif(new.chefe_id,''),new.data->>'chefeId');
  if tg_op = 'INSERT' then
    insert into public.rh_assignment_history(person_id,valid_from,role_code,chefe_id,chefe_name,person_snapshot,changed_by)
    values(new.id,date '0001-01-01',coalesce(nullif(new.role_code,''),new.data->>'role'),coalesce(nullif(new.chefe_id,''),new.data->>'chefeId'),manager_name,rh_private.person_snapshot(new),auth.uid());
    return new;
  end if;
  if new.role_code is not distinct from old.role_code and new.chefe_id is not distinct from old.chefe_id then return new; end if;
  effective := coalesce(nullif(current_setting('rh.team_transition_date',true),'')::date,(now() at time zone 'Europe/Lisbon')::date);
  if effective > (now() at time zone 'Europe/Lisbon')::date then raise exception 'A data da transicao ainda nao chegou'; end if;
  select h.* into previous from public.rh_assignment_history h where h.person_id = new.id and h.valid_to is null for update;
  if not found then raise exception 'Historico em falta. A alteracao foi cancelada'; end if;
  if effective < previous.valid_from then raise exception 'Existe uma alteracao posterior. Rever o historico'; end if;
  if effective = previous.valid_from then
    update public.rh_assignment_history set role_code=new.role_code,chefe_id=new.chefe_id,
      chefe_name=manager_name,person_snapshot=rh_private.person_snapshot(new),changed_by=coalesce(nullif(current_setting('rh.team_transition_actor',true),'')::uuid,auth.uid()) where id=previous.id;
  else
    update public.rh_assignment_history set valid_to=effective where id=previous.id;
    insert into public.rh_assignment_history(person_id,valid_from,role_code,chefe_id,chefe_name,person_snapshot,changed_by)
    values(new.id,effective,new.role_code,new.chefe_id,manager_name,rh_private.person_snapshot(new),coalesce(nullif(current_setting('rh.team_transition_actor',true),'')::uuid,auth.uid()));
  end if;
  return new;
end;
$$;
revoke all on function rh_private.capture_assignment() from public, anon, authenticated;
drop trigger if exists rh_capture_assignment on public.rh_persons;
create trigger rh_capture_assignment after insert or update of role_code,chefe_id on public.rh_persons
for each row execute function rh_private.capture_assignment();

create or replace function rh_private.can_read_assignment_day(target_person text,target_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_rh_admin() or exists (
    select 1 from public.user_profiles up where up.user_id=auth.uid() and up.role='gestor'
    and (up.person_id=target_person or exists (
      select 1 from public.rh_assignment_history h where h.person_id=target_person
      and h.chefe_id=up.person_id and h.valid_from<=target_date and (h.valid_to is null or target_date<h.valid_to)
    ))
  );
$$;
revoke all on function rh_private.can_read_assignment_day(text,date) from public, anon, authenticated;
grant execute on function rh_private.can_read_assignment_day(text,date) to authenticated;

drop policy if exists "assignment scoped read" on public.rh_assignment_history;
create policy "assignment scoped read" on public.rh_assignment_history for select to authenticated using (
  public.is_rh_admin() or person_id=public.current_person_id()
  or (chefe_id=public.current_person_id() and valid_from<=(now() at time zone 'Europe/Lisbon')::date)
);
drop policy if exists "transition admin read" on public.rh_team_transition_runs;
create policy "transition admin read" on public.rh_team_transition_runs for select to authenticated using(public.is_rh_admin());

drop policy if exists "attendance scoped read" on public.rh_attendance_records;
create policy "attendance scoped read" on public.rh_attendance_records for select to authenticated
using(rh_private.can_read_assignment_day(person_id,record_date));

-- Raw vacation rows must be wholly visible. Cross-team periods are clipped by the RPC below.
drop policy if exists "vacations scoped read" on public.rh_vacations;
create policy "vacations scoped read" on public.rh_vacations for select to authenticated using (
  public.is_rh_admin() or person_id=public.current_person_id() or exists (
    select 1 from public.rh_assignment_history h where h.person_id=rh_vacations.person_id
    and h.chefe_id=public.current_person_id() and h.valid_from<=rh_vacations.start_date
    and (h.valid_to is null or rh_vacations.end_date<h.valid_to)
  )
);

create or replace function public.rh_visible_vacations()
returns table(id text,person_id text,start_date date,end_date date,note text,color text,data jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sessao obrigatoria'; end if;
  if public.is_rh_admin() then
    return query select v.id,v.person_id,v.start_date,v.end_date,v.note,v.color,v.data,v.updated_at from public.rh_vacations v;
  else
    return query
    select v.id,v.person_id,v.start_date,v.end_date,v.note,v.color,v.data,v.updated_at
    from public.rh_vacations v where v.person_id=public.current_person_id()
    union all
    select v.id||'@'||h.id::text,v.person_id,greatest(v.start_date,h.valid_from),
      least(v.end_date,coalesce(h.valid_to-1,v.end_date)),v.note,v.color,
      jsonb_build_object('id',v.id||'@'||h.id::text,'personId',v.person_id,
        'start',greatest(v.start_date,h.valid_from),'end',least(v.end_date,coalesce(h.valid_to-1,v.end_date)),
        'note',v.note,'color',v.color),v.updated_at
    from public.rh_vacations v join public.rh_assignment_history h on h.person_id=v.person_id
    where v.person_id is distinct from public.current_person_id() and h.chefe_id=public.current_person_id()
      and h.valid_from<=v.end_date and (h.valid_to is null or h.valid_to>v.start_date)
      and exists(select 1 from public.user_profiles up where up.user_id=auth.uid() and up.role='gestor');
  end if;
end;
$$;
revoke all on function public.rh_visible_vacations() from public, anon, authenticated;
grant execute on function public.rh_visible_vacations() to authenticated;

create or replace function public.rh_team_history_version()
returns integer language sql stable set search_path = '' as $$ select 1; $$;
revoke all on function public.rh_team_history_version() from public, anon, authenticated;
grant execute on function public.rh_team_history_version() to authenticated;

alter table public.rh_team_transition_runs add column if not exists before_persons jsonb not null default '[]'::jsonb;

create or replace function rh_private.apply_team_transition(p_request_id uuid,p_effective_date date,p_changes jsonb,p_actor uuid,p_validate_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  person public.rh_persons;
  existing public.rh_team_transition_runs;
  manager public.rh_persons;
  manager_role text;
  events jsonb;
  previous_setting text;
  previous_actor text;
  backup_rows jsonb;
begin
  if p_actor is null or not exists(select 1 from public.user_profiles where user_id=p_actor and role='admin') then raise exception 'Apenas admin pode confirmar transicoes'; end if;
  if p_effective_date is null then raise exception 'Falta confirmar a data de inicio'; end if;
  if not p_validate_only and p_effective_date>(now() at time zone 'Europe/Lisbon')::date then raise exception 'A data ainda nao chegou. Nenhuma alteracao aplicada'; end if;
  if p_request_id is null or p_changes is null or jsonb_typeof(p_changes)<>'array' then raise exception 'Transicao invalida'; end if;
  if jsonb_array_length(p_changes)<1 or jsonb_array_length(p_changes)>100 then raise exception 'Transicao invalida'; end if;
  if (select count(distinct c.value->>'personId') from jsonb_array_elements(p_changes)c)<>jsonb_array_length(p_changes) then raise exception 'Colaboradores duplicados'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select r.* into existing from public.rh_team_transition_runs r where r.request_id=p_request_id;
  if found then
    if existing.effective_date<>p_effective_date or existing.changes<>p_changes then raise exception 'Confirmacao repetida com dados diferentes'; end if;
    return jsonb_build_object('ok',true,'alreadyApplied',true,'requestId',p_request_id);
  end if;
  perform 1 from public.rh_persons p where p.id in (
    select c.value->>'personId' from jsonb_array_elements(p_changes)c union
    select c.value->>'toChefeId' from jsonb_array_elements(p_changes)c
  ) order by p.id for update;
  for change in select value from jsonb_array_elements(p_changes) loop
    if not(change ?& array['personId','fromRole','fromChefeId','toRole','toChefeId']) then raise exception 'Campos em falta'; end if;
    select p.* into person from public.rh_persons p where p.id=change->>'personId';
    if not found or not person.ativo then raise exception 'Colaborador inexistente ou inativo'; end if;
    if coalesce(nullif(person.role_code,''),person.data->>'role','')<>coalesce(change->>'fromRole','') or coalesce(nullif(person.chefe_id,''),person.data->>'chefeId','')<>coalesce(change->>'fromChefeId','') then raise exception 'A equipa ou funcao mudou. Confirmar novamente'; end if;
    if exists(select 1 from public.rh_assignment_history h where h.person_id=person.id and h.valid_to is null and h.valid_from>p_effective_date) then raise exception 'Existe uma alteracao posterior. Rever o historico'; end if;
    if (change->>'toRole') not in ('coordenador','capitao','chefe_equipa','vendedor','gestor_parceiros') or coalesce(change->>'toRole','')='' then raise exception 'Funcao invalida'; end if;
    if person.entrada is not null and p_effective_date<person.entrada then raise exception 'Data anterior a entrada'; end if;
    if person.saida is not null and p_effective_date>person.saida then raise exception 'Data posterior a saida'; end if;
    if coalesce(change->>'toChefeId','')<>'' then
      select p.* into manager from public.rh_persons p where p.id=change->>'toChefeId';
      if not found or not manager.ativo then raise exception 'Gestor inexistente ou inativo'; end if;
      select c.value->>'toRole' into manager_role from jsonb_array_elements(p_changes)c where c.value->>'personId'=manager.id;
      if coalesce(manager_role,manager.role_code,'') not in ('chefe_equipa','coordenador','capitao') then raise exception 'O destino nao e gestor de equipa'; end if;
    end if;
  end loop;
  if p_validate_only then return jsonb_build_object('ok',true,'validated',true); end if;
  select jsonb_agg(to_jsonb(p)) into backup_rows from public.rh_persons p
    where p.id in (select c.value->>'personId' from jsonb_array_elements(p_changes)c);
  previous_setting := current_setting('rh.team_transition_date',true);
  previous_actor := current_setting('rh.team_transition_actor',true);
  perform set_config('rh.team_transition_date',p_effective_date::text,true);
  perform set_config('rh.team_transition_actor',p_actor::text,true);
  for change in select value from jsonb_array_elements(p_changes) loop
    select p.* into person from public.rh_persons p where p.id=change->>'personId';
    events := '[]'::jsonb;
    if coalesce(person.role_code,'')<>change->>'toRole' then
      events := events||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'field','role','from',person.role_code,'to',change->>'toRole','type','Transicao de equipa','date',p_effective_date,'at',now()));
    end if;
    if coalesce(person.chefe_id,'')<>change->>'toChefeId' then
      events := events||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'field','chefeId','from',person.chefe_id,'to',change->>'toChefeId','type','Transicao de equipa','date',p_effective_date,'at',now()));
    end if;
    update public.rh_persons set role_code=change->>'toRole',chefe_id=change->>'toChefeId',
      data=person.data||jsonb_build_object('role',change->>'toRole','chefeId',change->>'toChefeId',
        'rhMovements',coalesce(person.data->'rhMovements','[]'::jsonb)||events)
      where public.rh_persons.id=person.id;
  end loop;
  perform set_config('rh.team_transition_date',coalesce(previous_setting,''),true);
  perform set_config('rh.team_transition_actor',coalesce(previous_actor,''),true);
  insert into public.rh_team_transition_runs(request_id,effective_date,changes,changed_by,before_persons)
    values(p_request_id,p_effective_date,p_changes,p_actor,coalesce(backup_rows,'[]'::jsonb));
  return jsonb_build_object('ok',true,'alreadyApplied',false,'requestId',p_request_id,'count',jsonb_array_length(p_changes));
end;
$$;
revoke all on function rh_private.apply_team_transition(uuid,date,jsonb,uuid,boolean) from public, anon, authenticated;
create or replace function public.apply_rh_team_transition(p_request_id uuid,p_effective_date date,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_rh_admin() or auth.uid() is null then raise exception 'Apenas admin pode confirmar transicoes'; end if;
  return rh_private.apply_team_transition(p_request_id,p_effective_date,p_changes,auth.uid(),false);
end;
$$;
revoke all on function public.apply_rh_team_transition(uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.apply_rh_team_transition(uuid,date,jsonb) to authenticated;


-- Self-service dated role/team changes. Installation never schedules an employee change.


create table if not exists public.rh_team_change_plans (
  request_id uuid primary key,
  effective_date date not null,
  changes jsonb not null,
  status text not null check(status in ('pending','applied','cancelled','failed')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);
alter table public.rh_team_change_plans enable row level security;
revoke all on public.rh_team_change_plans from public,anon,authenticated;
grant select on public.rh_team_change_plans to authenticated;
drop policy if exists "team plans admin read" on public.rh_team_change_plans;
create policy "team plans admin read" on public.rh_team_change_plans for select to authenticated using(public.is_rh_admin());

create or replace function rh_private.require_dated_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.role_code is distinct from old.role_code or new.chefe_id is distinct from old.chefe_id)
    and nullif(current_setting('rh.team_transition_date',true),'') is null then
    raise exception 'Usa Funcoes e equipas e confirma a data da alteracao';
  end if;
  return new;
end;
$$;
revoke all on function rh_private.require_dated_assignment() from public,anon,authenticated;
drop trigger if exists rh_require_dated_assignment on public.rh_persons;
create trigger rh_require_dated_assignment before update of role_code,chefe_id on public.rh_persons
  for each row execute function rh_private.require_dated_assignment();

create or replace function public.rh_submit_team_change(p_request_id uuid,p_effective_date date,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous public.rh_team_change_plans;
  result jsonb;
  next_status text;
begin
  if auth.uid() is null or not public.is_rh_admin() then raise exception 'Apenas admin pode alterar funcoes e equipas'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rh.team.plans',0));
  select * into previous from public.rh_team_change_plans where request_id=p_request_id for update;
  if found then
    if previous.effective_date is distinct from p_effective_date or previous.changes is distinct from p_changes then
      raise exception 'Pedido repetido com dados diferentes';
    end if;
    return jsonb_build_object('ok',true,'alreadySubmitted',true,'status',previous.status);
  end if;
  perform rh_private.apply_team_transition(p_request_id,p_effective_date,p_changes,auth.uid(),true);
  if exists (
    select 1 from public.rh_team_change_plans plan,
      jsonb_array_elements(plan.changes) a,jsonb_array_elements(p_changes) b
    where plan.status='pending' and a.value->>'personId'=b.value->>'personId'
  ) then raise exception 'Um colaborador ja tem uma alteracao agendada. Cancela ou aguarda essa alteracao'; end if;
  if p_effective_date>(now() at time zone 'Europe/Lisbon')::date then next_status:='pending';
  else
    result:=rh_private.apply_team_transition(p_request_id,p_effective_date,p_changes,auth.uid(),false);
    next_status:='applied';
  end if;
  insert into public.rh_team_change_plans(request_id,effective_date,changes,status,created_by,finished_at)
  values(p_request_id,p_effective_date,p_changes,next_status,auth.uid(),case when next_status='applied' then now() end);
  return jsonb_build_object('ok',true,'status',next_status,'requestId',p_request_id);
end;
$$;
revoke all on function public.rh_submit_team_change(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.rh_submit_team_change(uuid,date,jsonb) to authenticated;

create or replace function public.rh_cancel_team_change(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan public.rh_team_change_plans;
begin
  if auth.uid() is null or not public.is_rh_admin() then raise exception 'Apenas admin pode cancelar alteracoes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rh.team.plans',0));
  select * into plan from public.rh_team_change_plans where request_id=p_request_id for update;
  if not found then raise exception 'Alteracao inexistente'; end if;
  if plan.status='cancelled' then return jsonb_build_object('ok',true); end if;
  if plan.status not in ('pending','failed') then raise exception 'A alteracao ja foi aplicada. Cria uma nova alteracao com outra data'; end if;
  update public.rh_team_change_plans set status='cancelled',finished_at=now(),error=null where request_id=p_request_id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.rh_cancel_team_change(uuid) from public,anon,authenticated;
grant execute on function public.rh_cancel_team_change(uuid) to authenticated;

create or replace function rh_private.process_due_team_changes()
returns integer language plpgsql security definer set search_path = '' as $$
declare plan public.rh_team_change_plans; applied integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('rh.team.plans',0));
  for plan in select * from public.rh_team_change_plans
    where status='pending' and effective_date<=(now() at time zone 'Europe/Lisbon')::date
    order by effective_date,created_at,request_id for update loop
    begin
      perform rh_private.apply_team_transition(plan.request_id,plan.effective_date,plan.changes,plan.created_by,false);
      update public.rh_team_change_plans set status='applied',finished_at=now(),error=null where request_id=plan.request_id;
      applied:=applied+1;
    exception when others then
      update public.rh_team_change_plans set status='failed',finished_at=now(),error=left(sqlerrm,500) where request_id=plan.request_id;
    end;
  end loop;
  return applied;
end;
$$;
revoke all on function rh_private.process_due_team_changes() from public,anon,authenticated;

create or replace function public.rh_process_due_team_changes()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_rh_admin() then raise exception 'Apenas admin'; end if;
  return rh_private.process_due_team_changes();
end;
$$;
revoke all on function public.rh_process_due_team_changes() from public,anon,authenticated;
grant execute on function public.rh_process_due_team_changes() to authenticated;

create or replace function public.rh_team_history_version()
returns integer language sql stable set search_path = '' as $$ select 2; $$;
revoke all on function public.rh_team_history_version() from public,anon,authenticated;
grant execute on function public.rh_team_history_version() to authenticated;
notify pgrst,'reload schema';


-- Supabase Cron: evaluate due changes every minute, including when the site is closed.
-- Dates are compared in Europe/Lisbon inside the function.

create extension if not exists pg_cron;
select cron.schedule('rh-team-changes-due','* * * * *','select rh_private.process_due_team_changes()');


commit;
select public.rh_team_history_version() as history_version,
  (select count(*) from public.rh_assignment_history) as history_rows,
  (select count(*) from public.rh_team_change_plans) as change_plans,
  (select active from cron.job where jobname='rh-team-changes-due') as scheduler_active;
