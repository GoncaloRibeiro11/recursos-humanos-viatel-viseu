begin;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated;
create table if not exists rh_release_backups.commission_permissions_20261126(entity text primary key,payload jsonb not null);
alter table rh_release_backups.commission_permissions_20261126 enable row level security;
revoke all on rh_release_backups.commission_permissions_20261126 from public,anon,authenticated;
insert into rh_release_backups.commission_permissions_20261126(entity,payload)
select tablename||':'||policyname,to_jsonb(p) from pg_policies p
where schemaname='public' and (tablename,policyname) in (('rh_assignment_history','assignment scoped read'),('rh_vacations','vacations scoped read'))
on conflict do nothing;
insert into rh_release_backups.commission_permissions_20261126 values('rh_visible_vacations',to_jsonb(pg_get_functiondef('public.rh_visible_vacations()'::regprocedure))) on conflict do nothing;

-- Commission-only accounts never inherit the historical RH access of a person.
drop policy if exists "assignment scoped read" on public.rh_assignment_history;
create policy "assignment scoped read" on public.rh_assignment_history for select to authenticated using (
  public.is_rh_admin() or (
    exists(select 1 from public.user_profiles where user_id=auth.uid() and role='gestor')
    and (person_id=public.current_person_id() or (chefe_id=public.current_person_id() and valid_from<=(now() at time zone 'Europe/Lisbon')::date))
  )
);
drop policy if exists "vacations scoped read" on public.rh_vacations;
create policy "vacations scoped read" on public.rh_vacations for select to authenticated using (
  public.is_rh_admin() or (
    exists(select 1 from public.user_profiles where user_id=auth.uid() and role='gestor')
    and (person_id=public.current_person_id() or exists (
      select 1 from public.rh_assignment_history h where h.person_id=rh_vacations.person_id
      and h.chefe_id=public.current_person_id() and h.valid_from<=rh_vacations.start_date
      and (h.valid_to is null or rh_vacations.end_date<h.valid_to)
    ))
  )
);

-- Preserve the established clipping of vacations at a team transition.
do $$ begin
  if to_regprocedure('public.rh_visible_vacations_before_commissions()') is null then
    alter function public.rh_visible_vacations() rename to rh_visible_vacations_before_commissions;
  end if;
end; $$;
create or replace function public.rh_visible_vacations()
returns table(id text,person_id text,start_date date,end_date date,note text,color text,data jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.is_rh_admin() or exists(select 1 from public.user_profiles where user_id=auth.uid() and role='gestor')) then
    raise exception 'Este acesso permite apenas consultar comissões.' using errcode='42501';
  end if;
  return query select * from public.rh_visible_vacations_before_commissions();
end; $$;
revoke all on function public.rh_visible_vacations_before_commissions() from public,anon,authenticated,service_role;
revoke all on function public.rh_visible_vacations() from public,anon;
grant execute on function public.rh_visible_vacations() to authenticated;
create or replace function public.rh_commissions_security_version() returns integer
language sql immutable set search_path = '' as $$ select 1; $$;
revoke all on function public.rh_commissions_security_version() from public,anon;
grant execute on function public.rh_commissions_security_version() to authenticated;
notify pgrst,'reload schema';
commit;
