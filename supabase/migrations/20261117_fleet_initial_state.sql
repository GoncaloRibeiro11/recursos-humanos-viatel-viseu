begin;
alter table public.rh_fleet_custody add column if not exists origin text not null default 'handover';
alter table public.rh_fleet_custody add column if not exists initial_recorded_at timestamptz;
alter table public.rh_fleet_custody add column if not exists initial_recorded_by uuid;
alter table public.rh_fleet_custody add column if not exists initial_source text;
alter table public.rh_fleet_custody alter column from_at drop not null;
alter table public.rh_fleet_custody alter column handover_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.rh_fleet_custody'::regclass and conname='rh_fleet_custody_origin') then
    alter table public.rh_fleet_custody add constraint rh_fleet_custody_origin check(
      (origin='handover' and handover_id is not null and from_at is not null and initial_source is null)
      or (origin='initial_state' and handover_id is null and from_at is null and initial_recorded_at is not null and initial_source is not null and initial_source in ('setup','manual')));
  end if;
end; $$;
create unique index if not exists rh_fleet_initial_once on public.rh_fleet_custody(vehicle_id) where origin='initial_state';
create table if not exists public.rh_fleet_initial_setup (
  id boolean primary key default true check(id), recorded_at timestamptz not null default now()
);
alter table public.rh_fleet_initial_setup enable row level security;
revoke all on public.rh_fleet_initial_setup from public,anon,authenticated;
grant select on public.rh_fleet_initial_setup to authenticated;
drop policy if exists fleet_admin_read on public.rh_fleet_initial_setup;
create policy fleet_admin_read on public.rh_fleet_initial_setup for select to authenticated using(public.is_rh_admin());

create or replace function public.rh_fleet_begin_initial_state(p_id uuid,p_version integer,p_source text)
returns public.rh_fleet_custody language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rh_fleet_vehicles;c public.rh_fleet_custody;p public.rh_persons;
begin
  select * into v from public.rh_fleet_vehicles where id=p_id for update;
  if v.id is null then raise exception 'Viatura indisponível.';end if;
  select * into c from public.rh_fleet_custody where vehicle_id=p_id and origin='initial_state';
  if c.id is not null then return c;end if;
  if p_version is distinct from v.version then raise exception 'A viatura mudou entretanto. Atualiza a frota.';end if;
  if p_source not in ('setup','manual') or p_source is null then raise exception 'Origem inválida.';end if;
  if not v.active or exists(select 1 from public.rh_fleet_custody where vehicle_id=p_id)
    or exists(select 1 from public.rh_fleet_handovers where vehicle_id=p_id and status='confirmed') then
    raise exception 'A situação inicial só pode ser registada antes do primeiro auto. O histórico existente é mantido.';
  end if;
  if exists(select 1 from public.rh_fleet_sign_sessions s join public.rh_fleet_handovers h on h.id=s.handover_id
    where h.vehicle_id=p_id and s.required and s.active) then raise exception 'Existe um pedido de assinaturas em curso. Revê esse auto antes de registar a situação inicial.';end if;
  select * into p from public.rh_persons where id=v.habitual_person_id;
  if p.id is null then raise exception 'Indica primeiro o responsável habitual na ficha da viatura.';end if;
  -- Unknown start is NULL: no historic dates, inspection, signature or old auto are invented.
  insert into public.rh_fleet_custody(vehicle_id,person_id,person_name,from_at,handover_id,origin,initial_recorded_at,initial_recorded_by,initial_source)
    values(v.id,p.id,p.name,null,null,'initial_state',now(),case when p_source='manual' then auth.uid() else null end,p_source) returning * into c;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id in
    (select id from public.rh_fleet_handovers where vehicle_id=p_id and status='draft');
  update public.rh_fleet_handovers set expected_custody_id=c.id,version=version+1,updated_at=now()
    where vehicle_id=p_id and status='draft' and expected_custody_id is null and data->>'kind' in ('temporary','permanent','return');
  update public.rh_fleet_vehicles set version=version+1,updated_at=now() where id=p_id;
  return c;
end; $$;
revoke all on function public.rh_fleet_begin_initial_state(uuid,integer,text) from public,anon,authenticated,service_role;

create or replace function public.rh_fleet_register_initial_state(p_vehicle_id uuid,p_vehicle_version integer)
returns public.rh_fleet_custody language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode registar a situação inicial.' using errcode='42501';end if;
  return public.rh_fleet_begin_initial_state(p_vehicle_id,p_vehicle_version,'manual');
end; $$;
revoke all on function public.rh_fleet_register_initial_state(uuid,integer) from public,anon;
grant execute on function public.rh_fleet_register_initial_state(uuid,integer) to authenticated;

-- One-time adoption of vehicles already associated when this installation begins.
do $$ declare first_run boolean;v public.rh_fleet_vehicles;
begin
  insert into public.rh_fleet_initial_setup(id) values(true) on conflict do nothing returning id into first_run;
  if first_run then
    for v in select * from public.rh_fleet_vehicles x where x.active and x.habitual_person_id is not null
      and exists(select 1 from public.rh_persons p where p.id=x.habitual_person_id)
      and not exists(select 1 from public.rh_fleet_custody c where c.vehicle_id=x.id)
      and not exists(select 1 from public.rh_fleet_handovers h where h.vehicle_id=x.id and h.status='confirmed')
      and not exists(select 1 from public.rh_fleet_sign_sessions s join public.rh_fleet_handovers h on h.id=s.handover_id where h.vehicle_id=x.id and s.required and s.active)
      order by x.id
    loop perform public.rh_fleet_begin_initial_state(v.id,v.version,'setup');end loop;
  end if;
end; $$;
notify pgrst,'reload schema';
commit;
