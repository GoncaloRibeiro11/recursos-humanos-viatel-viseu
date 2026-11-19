-- Vehicle classification only; existing handover snapshots and dates stay intact.
begin;
set local lock_timeout='10s';
lock table public.rh_fleet_vehicles in share row exclusive mode;
create temporary table fleet_condition_before on commit drop as select to_jsonb(v)-'vehicle_condition' as row_data from public.rh_fleet_vehicles v;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated,service_role;
create table if not exists rh_release_backups.fleet_condition_20261119 as select * from fleet_condition_before;
alter table rh_release_backups.fleet_condition_20261119 enable row level security;
revoke all on rh_release_backups.fleet_condition_20261119 from public,anon,authenticated,service_role;
alter table public.rh_fleet_vehicles add column if not exists vehicle_condition text
  constraint rh_fleet_vehicle_condition_check check(vehicle_condition in ('new','recent','used'));

create or replace function public.rh_fleet_save_vehicle(p_id uuid,p_version integer,p_data jsonb)
returns public.rh_fleet_vehicles language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rh_fleet_vehicles;v_plate text;v_holder text;v_condition text;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir a frota.' using errcode='42501';end if;
  if p_id is null or p_version is null or p_version<0 or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Dados ou versão da viatura inválidos.';end if;
  if p_data?'vehicle_condition' then
    v_condition:=p_data->>'vehicle_condition';
    if jsonb_typeof(p_data->'vehicle_condition') is distinct from 'string' or v_condition not in ('new','recent','used') then raise exception 'Seleciona o estado da viatura: Nova, Recente ou Usada.';end if;
  end if;
  v_plate:=upper(regexp_replace(trim(p_data->>'plate'),'\s','','g'));
  if nullif(v_plate,'') is null or nullif(trim(p_data->>'make_model'),'') is null then raise exception 'Indica a matrícula e a marca/modelo.';end if;
  v_holder:=nullif(p_data->>'habitual_person_id','');
  if v_holder is not null and not exists(select 1 from public.rh_persons where id=v_holder) then raise exception 'Colaborador não encontrado.';end if;
  if p_version=0 then
    insert into public.rh_fleet_vehicles(id,plate,make_model,cartrack_number,company,habitual_person_id,odometer,insurance_until,inspection_until,transport_until,active,vehicle_condition)
      values(p_id,v_plate,trim(p_data->>'make_model'),coalesce(trim(p_data->>'cartrack_number'),''),coalesce(trim(p_data->>'company'),''),v_holder,
        coalesce(nullif(p_data->>'odometer','')::bigint,0),nullif(p_data->>'insurance_until','')::date,nullif(p_data->>'inspection_until','')::date,nullif(p_data->>'transport_until','')::date,coalesce((p_data->>'active')::boolean,true),v_condition)
      on conflict(id) do nothing returning * into v;
    if v.id is null then select * into v from public.rh_fleet_vehicles where id=p_id;end if;
  else
    select * into v from public.rh_fleet_vehicles where id=p_id for update;
    if v.id is null or v.version<>p_version then raise exception 'A viatura mudou noutro separador. Atualiza a frota e revê os dados.';end if;
    if coalesce((p_data->>'active')::boolean,true)=false and exists(select 1 from public.rh_fleet_custody where vehicle_id=p_id and to_at is null) then raise exception 'Regista primeiro a devolução da viatura.';end if;
    if coalesce(nullif(p_data->>'odometer','')::bigint,0)<v.odometer then raise exception 'Os quilómetros não podem diminuir.';end if;
    if not(p_data?'vehicle_condition') then v_condition:=v.vehicle_condition;end if;
    update public.rh_fleet_vehicles set plate=v_plate,make_model=trim(p_data->>'make_model'),cartrack_number=coalesce(trim(p_data->>'cartrack_number'),''),company=coalesce(trim(p_data->>'company'),''),habitual_person_id=v_holder,
      odometer=coalesce(nullif(p_data->>'odometer','')::bigint,0),insurance_until=nullif(p_data->>'insurance_until','')::date,
      inspection_until=case when p_data?'inspection_until' then nullif(p_data->>'inspection_until','')::date else v.inspection_until end,
      transport_until=case when p_data?'transport_until' then nullif(p_data->>'transport_until','')::date else v.transport_until end,
      vehicle_condition=v_condition,active=coalesce((p_data->>'active')::boolean,true),version=version+1,updated_at=now() where id=p_id returning * into v;
  end if;
  return v;
end; $$;
revoke all on function public.rh_fleet_save_vehicle(uuid,integer,jsonb) from public,anon;
grant execute on function public.rh_fleet_save_vehicle(uuid,integer,jsonb) to authenticated;
do $$ begin
  if exists((select row_data from fleet_condition_before except all select to_jsonb(v)-'vehicle_condition' from public.rh_fleet_vehicles v)
    union all (select to_jsonb(v)-'vehicle_condition' from public.rh_fleet_vehicles v except all select row_data from fleet_condition_before)) then
    raise exception 'Existing vehicle data changed; migration aborted.';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
select 'FROTA UPDATED - EXISTING VEHICLE DATA PRESERVED' as result,count(*) as vehicles from public.rh_fleet_vehicles;
