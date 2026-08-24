-- Mapa RH Viatel - Supabase schema with Row Level Security.
-- Run this in Supabase SQL Editor after creating the project.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'gestor')),
  person_id text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_persons (
  id text primary key,
  name text not null,
  role_code text,
  chefe_id text,
  empresa text,
  carga text,
  ativo boolean not null default true,
  entrada date,
  saida date,
  nascimento date,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_vacations (
  id text primary key,
  person_id text not null references public.rh_persons(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  color text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.rh_attendance_records (
  person_id text not null references public.rh_persons(id) on delete cascade,
  record_date date not null,
  code text not null,
  updated_at timestamptz not null default now(),
  primary key (person_id, record_date)
);

alter table public.user_profiles enable row level security;
alter table public.rh_persons enable row level security;
alter table public.rh_vacations enable row level security;
alter table public.rh_attendance_records enable row level security;

create or replace function public.is_rh_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_person_id()
returns text
language sql
security definer
set search_path = public
as $$
  select person_id from public.user_profiles where user_id = auth.uid();
$$;

create or replace function public.can_read_person(target_person_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_rh_admin()
    or exists (
      select 1
      from public.user_profiles up
      join public.rh_persons p on p.id = target_person_id
      where up.user_id = auth.uid()
        and up.role = 'gestor'
        and (
          p.chefe_id = up.person_id
          or p.id = up.person_id
        )
    );
$$;

drop policy if exists "profiles read own or admin" on public.user_profiles;
create policy "profiles read own or admin"
on public.user_profiles
for select
to authenticated
using (user_id = auth.uid() or public.is_rh_admin());

drop policy if exists "profiles admin write" on public.user_profiles;
create policy "profiles admin write"
on public.user_profiles
for all
to authenticated
using (public.is_rh_admin())
with check (public.is_rh_admin());

drop policy if exists "persons scoped read" on public.rh_persons;
create policy "persons scoped read"
on public.rh_persons
for select
to authenticated
using (public.can_read_person(id));

drop policy if exists "persons admin write" on public.rh_persons;
create policy "persons admin write"
on public.rh_persons
for all
to authenticated
using (public.is_rh_admin())
with check (public.is_rh_admin());

drop policy if exists "vacations scoped read" on public.rh_vacations;
create policy "vacations scoped read"
on public.rh_vacations
for select
to authenticated
using (public.can_read_person(person_id));

drop policy if exists "vacations admin write" on public.rh_vacations;
create policy "vacations admin write"
on public.rh_vacations
for all
to authenticated
using (public.is_rh_admin())
with check (public.is_rh_admin());

drop policy if exists "attendance scoped read" on public.rh_attendance_records;
create policy "attendance scoped read"
on public.rh_attendance_records
for select
to authenticated
using (public.can_read_person(person_id));

drop policy if exists "attendance admin write" on public.rh_attendance_records;
create policy "attendance admin write"
on public.rh_attendance_records
for all
to authenticated
using (public.is_rh_admin())
with check (public.is_rh_admin());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_profiles on public.user_profiles;
create trigger touch_user_profiles before update on public.user_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_rh_persons on public.rh_persons;
create trigger touch_rh_persons before update on public.rh_persons
for each row execute function public.touch_updated_at();

drop trigger if exists touch_rh_vacations on public.rh_vacations;
create trigger touch_rh_vacations before update on public.rh_vacations
for each row execute function public.touch_updated_at();

drop trigger if exists touch_rh_attendance_records on public.rh_attendance_records;
create trigger touch_rh_attendance_records before update on public.rh_attendance_records
for each row execute function public.touch_updated_at();
