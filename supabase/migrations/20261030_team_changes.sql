-- Self-service dated role/team changes. Installation never schedules an employee change.
begin;

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
commit;
