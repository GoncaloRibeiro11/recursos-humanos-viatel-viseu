begin;
create table if not exists public.rh_fleet_deletions(
  id uuid primary key,entity text not null check(entity in ('handover','vehicle')),
  number bigint,version integer not null,vehicle_id uuid not null,plate text not null,
  deleted_by uuid,deleted_at timestamptz not null default now(),files_pending boolean not null default false
);
create table if not exists public.rh_fleet_deletion_backups(
  id uuid primary key references public.rh_fleet_deletions(id),data jsonb not null
);
alter table public.rh_fleet_deletions enable row level security;
alter table public.rh_fleet_deletion_backups enable row level security;
revoke all on public.rh_fleet_deletions,public.rh_fleet_deletion_backups from public,anon,authenticated;
grant select on public.rh_fleet_deletions to authenticated;
drop policy if exists fleet_deletions_admin on public.rh_fleet_deletions;
create policy fleet_deletions_admin on public.rh_fleet_deletions for select to authenticated using(public.is_rh_admin());
grant select on public.rh_fleet_deletions,public.rh_fleet_deletion_backups to service_role;

create or replace function public.rh_fleet_prevent_recreation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.rh_fleet_deletions where id=new.id and entity=case when tg_table_name='rh_fleet_handovers' then 'handover' else 'vehicle' end) then
    raise exception 'Este registo foi eliminado. Um rascunho antigo não o pode recriar.';
  end if;
  return new;
end; $$;
drop trigger if exists fleet_prevent_recreation on public.rh_fleet_handovers;
create trigger fleet_prevent_recreation before insert on public.rh_fleet_handovers for each row execute function public.rh_fleet_prevent_recreation();
drop trigger if exists fleet_prevent_recreation on public.rh_fleet_vehicles;
create trigger fleet_prevent_recreation before insert on public.rh_fleet_vehicles for each row execute function public.rh_fleet_prevent_recreation();

create or replace function public.rh_fleet_lock_file_owner() returns trigger
language plpgsql security definer set search_path=public,storage,pg_temp as $$
begin
  if split_part(new.name,'/',1) !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Auto inválido para este ficheiro.';end if;
  -- Serialize uploads with deletion, including uploads made by the server.
  perform 1 from public.rh_fleet_handovers where id=split_part(new.name,'/',1)::uuid for key share;
  if not found then raise exception 'O auto foi eliminado. O ficheiro não pode ser anexado.';end if;
  return new;
end; $$;
drop trigger if exists fleet_lock_file_owner on storage.objects;
create trigger fleet_lock_file_owner before insert on storage.objects for each row when(new.bucket_id='rh-fleet') execute function public.rh_fleet_lock_file_owner();

create or replace function public.rh_fleet_delete_handover(p_id uuid,p_version integer,p_number text,p_test boolean)
returns public.rh_fleet_deletions language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;v public.rh_fleet_vehicles;a public.rh_fleet_deletions;
  c public.rh_fleet_custody;previous public.rh_fleet_custody;conflicts text;external boolean;at_time timestamptz;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode eliminar autos.' using errcode='42501';end if;
  if p_test is distinct from true then raise exception 'Confirma explicitamente a eliminação do auto de teste.';end if;
  select * into a from public.rh_fleet_deletions where id=p_id and entity='handover';
  if a.id is not null then
    if a.version is distinct from p_version or upper(trim(p_number)) is distinct from 'FRO-'||lpad(a.number::text,greatest(5,length(a.number::text)),'0') then raise exception 'A confirmação não corresponde ao auto eliminado.';end if;
    return a;
  end if;
  select vehicle_id into v.id from public.rh_fleet_handovers where id=p_id;
  select * into v from public.rh_fleet_vehicles where id=v.id for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.id is null then raise exception 'O auto já não existe. Atualiza a lista.';end if;
  if h.version is distinct from p_version then raise exception 'O auto mudou entretanto. Atualiza antes de eliminar.';end if;
  if upper(trim(p_number)) is distinct from 'FRO-'||lpad(h.number::text,greatest(5,length(h.number::text)),'0') then raise exception 'O número indicado não corresponde ao auto.';end if;
  if h.status='confirmed' then
    external:=coalesce(h.data->>'destination'='external_structure',false);at_time:=(h.data->>'at')::timestamptz;
    select * into c from public.rh_fleet_custody where handover_id=h.id for update;
    select * into previous from public.rh_fleet_custody where id=h.expected_custody_id for update;
    select string_agg('FRO-'||lpad(number::text,greatest(5,length(number::text)),'0'),', ' order by number) into conflicts
      from public.rh_fleet_handovers where id<>h.id and expected_custody_id=c.id;
    if conflicts is not null then raise exception 'Elimina primeiro os autos de teste dependentes: %.',conflicts;end if;
    if exists(select 1 from public.rh_fleet_handovers where vehicle_id=v.id and id<>h.id and status='confirmed' and (data->>'at')::timestamptz>=at_time)
      or (h.data->>'kind'<>'return' and (c.id is null or c.to_at is not null or c.vehicle_id<>v.id))
      or (h.data->>'kind'='return' and exists(select 1 from public.rh_fleet_custody where vehicle_id=v.id and to_at is null)) then
      raise exception 'Existem movimentos posteriores. Não é possível eliminar este auto sem alterar o histórico real.';
    end if;
    if h.snapshot is null or h.snapshot->>'template_version' is distinct from '1'
      or (select count(*) from public.rh_fleet_custody where handover_id=h.id)>1
      or v.odometer is distinct from (h.data->>'odometer')::bigint
      or (h.data->>'kind' in ('initial','permanent') and v.habitual_person_id is distinct from h.data->>'to_person_id')
      or (external and (v.active or v.habitual_person_id is not null))
      or (h.expected_custody_id is not null and (previous.id is null or previous.vehicle_id<>v.id or previous.to_at is distinct from at_time)) then
      raise exception 'A viatura mudou depois deste auto ou falta o estado anterior. A eliminação foi bloqueada para proteger o histórico.';
    end if;
  elsif h.status not in ('draft','cancelled') or exists(select 1 from public.rh_fleet_custody where handover_id=h.id) then
    raise exception 'O estado deste auto não permite eliminação.';
  end if;
  insert into public.rh_fleet_deletions(id,entity,number,version,vehicle_id,plate,deleted_by,files_pending)
    values(h.id,'handover',h.number,h.version,v.id,v.plate,auth.uid(),true) returning * into a;
  insert into public.rh_fleet_deletion_backups values(h.id,jsonb_build_object('handover',to_jsonb(h),'vehicle',to_jsonb(v),'custody',
    (select jsonb_agg(to_jsonb(item)) from public.rh_fleet_custody item where item.id=c.id or item.id=previous.id),
    'receipts',(select jsonb_agg(to_jsonb(r)) from public.rh_fleet_signature_receipts r where handover_id=h.id)));
  delete from public.rh_fleet_signature_receipts where handover_id=h.id;
  delete from public.rh_fleet_share_links where handover_id=h.id;
  delete from public.rh_fleet_sign_sessions where handover_id=h.id;
  if h.status='confirmed' then
    delete from public.rh_fleet_custody where handover_id=h.id;
    if previous.id is not null then update public.rh_fleet_custody set to_at=null where id=previous.id;end if;
    update public.rh_fleet_vehicles set odometer=(h.snapshot->'vehicle'->>'odometer')::bigint,
      habitual_person_id=case when external or h.data->>'kind' in ('initial','permanent') then (select id from public.rh_persons where id=h.snapshot->'vehicle'->>'habitual_person_id') else habitual_person_id end,
      active=case when external then coalesce((h.snapshot->'vehicle'->>'active')::boolean,true) else active end,version=version+1,updated_at=now() where id=v.id;
  end if;
  delete from public.rh_fleet_handovers where id=h.id;
  return a;
end; $$;

create or replace function public.rh_fleet_pending_deletions() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode consultar eliminações.' using errcode='42501';end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(a) order by deleted_at) from public.rh_fleet_deletions a where entity='handover' and files_pending),'[]'::jsonb));
end; $$;
create or replace function public.rh_fleet_deleted_info(p_id uuid) returns public.rh_fleet_deletions
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.rh_fleet_deletions;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir eliminações.' using errcode='42501';end if;
  select * into a from public.rh_fleet_deletions where id=p_id and entity='handover';
  if a.id is null then raise exception 'Não existe uma eliminação para este auto.';end if;
  return a;
end; $$;
create or replace function public.rh_fleet_mark_deleted_files(p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from storage.objects where bucket_id='rh-fleet' and split_part(name,'/',1)=p_id::text) then raise exception 'Existem anexos por eliminar.';end if;
  update public.rh_fleet_deletions set files_pending=false where id=p_id and entity='handover';
  return found;
end; $$;

create or replace function public.rh_fleet_delete_unused_vehicle(p_id uuid,p_version integer,p_plate text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rh_fleet_vehicles;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode eliminar viaturas.' using errcode='42501';end if;
  select * into v from public.rh_fleet_vehicles where id=p_id for update;
  if v.id is null then raise exception 'A viatura já não existe.';end if;
  if v.version is distinct from p_version then raise exception 'A viatura mudou entretanto. Atualiza antes de eliminar.';end if;
  if upper(trim(p_plate)) is distinct from v.plate then raise exception 'A matrícula não corresponde.';end if;
  if exists(select 1 from public.rh_fleet_handovers where vehicle_id=p_id)
    or exists(select 1 from public.rh_fleet_custody where vehicle_id=p_id and origin<>'initial_state')
    or exists(select 1 from public.rh_fleet_handovers where expected_custody_id in(select id from public.rh_fleet_custody where vehicle_id=p_id)) then
    raise exception 'Elimina primeiro os autos de teste associados a esta viatura. Para uma viatura real, mantém os autos e arquiva-a.';
  end if;
  insert into public.rh_fleet_deletions(id,entity,version,vehicle_id,plate,deleted_by) values(v.id,'vehicle',v.version,v.id,v.plate,auth.uid());
  insert into public.rh_fleet_deletion_backups values(v.id,jsonb_build_object('vehicle',to_jsonb(v),'custody',(select jsonb_agg(to_jsonb(c)) from public.rh_fleet_custody c where vehicle_id=v.id)));
  delete from public.rh_fleet_custody where vehicle_id=p_id and origin='initial_state';
  delete from public.rh_fleet_vehicles where id=p_id;
  return true;
end; $$;
revoke all on function public.rh_fleet_prevent_recreation(),public.rh_fleet_lock_file_owner(),public.rh_fleet_mark_deleted_files(uuid) from public,anon,authenticated;
grant execute on function public.rh_fleet_mark_deleted_files(uuid) to service_role;
revoke all on function public.rh_fleet_delete_handover(uuid,integer,text,boolean),public.rh_fleet_pending_deletions(),public.rh_fleet_deleted_info(uuid),public.rh_fleet_delete_unused_vehicle(uuid,integer,text) from public,anon;
grant execute on function public.rh_fleet_delete_handover(uuid,integer,text,boolean),public.rh_fleet_pending_deletions(),public.rh_fleet_deleted_info(uuid),public.rh_fleet_delete_unused_vehicle(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
