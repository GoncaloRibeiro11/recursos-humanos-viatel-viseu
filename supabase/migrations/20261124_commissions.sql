begin;
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check(role in ('admin','gestor','vendedor'));
create table if not exists public.rh_commission_identities(
 nif text primary key check(nif ~ '^[0-9]{9}$'),
 person_id text not null unique references public.rh_persons(id),
 source_name text not null
);
create table if not exists public.rh_commissions(
 period date not null check(extract(day from period)=1),
 owner_nif text not null check(owner_nif ~ '^[0-9]{9}$'),
 chief_nif text check(chief_nif ~ '^[0-9]{9}$'),
 source_name text not null,
 total numeric not null,
 payload jsonb not null,
 primary key(period,owner_nif)
);
alter table public.rh_commission_identities enable row level security;
alter table public.rh_commissions enable row level security;
revoke all on public.rh_commission_identities,public.rh_commissions from anon;
grant select,insert,update,delete on public.rh_commission_identities,public.rh_commissions to authenticated;
drop policy if exists identities_admin on public.rh_commission_identities;
drop policy if exists identities_self on public.rh_commission_identities;
drop policy if exists commissions_admin on public.rh_commissions;
drop policy if exists commissions_scoped on public.rh_commissions;
create policy identities_admin on public.rh_commission_identities for all to authenticated using(public.is_rh_admin()) with check(public.is_rh_admin());
create policy identities_self on public.rh_commission_identities for select to authenticated using(person_id=public.current_person_id());
create policy commissions_admin on public.rh_commissions for all to authenticated using(public.is_rh_admin()) with check(public.is_rh_admin());
create policy commissions_scoped on public.rh_commissions for select to authenticated using(
 exists(select 1 from public.rh_commission_identities i where i.person_id=public.current_person_id() and i.nif=owner_nif)
 or (
 exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='gestor')
 and exists(select 1 from public.rh_commission_identities i where i.person_id=public.current_person_id() and i.nif=chief_nif)
 )
);
comment on table public.rh_commissions is 'Private monthly personal payloads. Chiefs access only months attributed to their NIF; owner retains own history. No public report files.';
commit;
