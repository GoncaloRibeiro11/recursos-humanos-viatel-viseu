-- Frota is independent from HR attendance, holidays and team assignments.
begin;
create table if not exists public.rh_fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique check(length(plate) between 2 and 20),
  make_model text not null check(length(make_model) between 1 and 120),
  cartrack_number text not null default '' check(length(cartrack_number)<=80),
  company text not null default '' check(length(company)<=120),
  habitual_person_id text,
  odometer bigint not null default 0 check(odometer between 0 and 99999999),
  insurance_until date, inspection_until date, transport_until date,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.rh_fleet_handovers (
  id uuid primary key,
  number bigint generated always as identity unique,
  vehicle_id uuid not null references public.rh_fleet_vehicles(id),
  status text not null default 'draft' check(status in ('draft','confirmed','cancelled')),
  data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object' and octet_length(data::text)<=2000000),
  snapshot jsonb,
  expected_custody_id uuid,
  version integer not null default 1,
  created_by uuid not null, confirmed_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), confirmed_at timestamptz
);
create table if not exists public.rh_fleet_custody (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.rh_fleet_vehicles(id),
  person_id text not null,
  person_name text not null,
  from_at timestamptz not null, to_at timestamptz,
  handover_id uuid not null unique references public.rh_fleet_handovers(id),
  check(to_at is null or to_at>from_at)
);
create unique index if not exists rh_fleet_one_holder on public.rh_fleet_custody(vehicle_id) where to_at is null;
create index if not exists rh_fleet_custody_dates on public.rh_fleet_custody(vehicle_id,from_at);
create index if not exists rh_fleet_handover_vehicle on public.rh_fleet_handovers(vehicle_id,created_at);
alter table public.rh_fleet_vehicles enable row level security;
alter table public.rh_fleet_handovers enable row level security;
alter table public.rh_fleet_custody enable row level security;
revoke all on public.rh_fleet_vehicles,public.rh_fleet_handovers,public.rh_fleet_custody from anon,authenticated;
grant select on public.rh_fleet_vehicles,public.rh_fleet_handovers,public.rh_fleet_custody to authenticated;
drop policy if exists fleet_admin_read on public.rh_fleet_vehicles;
create policy fleet_admin_read on public.rh_fleet_vehicles for select to authenticated using(public.is_rh_admin());
drop policy if exists fleet_admin_read on public.rh_fleet_handovers;
create policy fleet_admin_read on public.rh_fleet_handovers for select to authenticated using(public.is_rh_admin());
drop policy if exists fleet_admin_read on public.rh_fleet_custody;
create policy fleet_admin_read on public.rh_fleet_custody for select to authenticated using(public.is_rh_admin());

create or replace function public.rh_fleet_version() returns integer language sql security invoker set search_path=public as $$ select 1; $$;

create or replace function public.rh_fleet_save_vehicle(p_id uuid,p_version integer,p_data jsonb)
returns public.rh_fleet_vehicles language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.rh_fleet_vehicles; v_plate text; v_holder text;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir a frota.' using errcode='42501'; end if;
  v_plate:=upper(regexp_replace(trim(p_data->>'plate'),'\s','','g'));
  if nullif(v_plate,'') is null or nullif(trim(p_data->>'make_model'),'') is null then raise exception 'Indica a matrícula e a marca/modelo.'; end if;
  v_holder:=nullif(p_data->>'habitual_person_id','');
  if v_holder is not null and not exists(select 1 from public.rh_persons where id=v_holder) then raise exception 'Colaborador não encontrado.'; end if;
  if p_version=0 then
    insert into public.rh_fleet_vehicles(id,plate,make_model,cartrack_number,company,habitual_person_id,odometer,insurance_until,inspection_until,transport_until,active)
    values(p_id,v_plate,trim(p_data->>'make_model'),coalesce(trim(p_data->>'cartrack_number'),''),coalesce(trim(p_data->>'company'),''),v_holder,
      coalesce(nullif(p_data->>'odometer','')::bigint,0),nullif(p_data->>'insurance_until','')::date,nullif(p_data->>'inspection_until','')::date,nullif(p_data->>'transport_until','')::date,coalesce((p_data->>'active')::boolean,true))
    on conflict(id) do nothing returning * into v;
    if v.id is null then select * into v from public.rh_fleet_vehicles where id=p_id; end if;
  else
    select * into v from public.rh_fleet_vehicles where id=p_id for update;
    if v.id is null or v.version<>p_version then raise exception 'A viatura mudou noutro separador. Atualiza a frota e revê os dados.'; end if;
    if coalesce((p_data->>'active')::boolean,true)=false and exists(select 1 from public.rh_fleet_custody where vehicle_id=p_id and to_at is null) then raise exception 'Regista primeiro a devolução da viatura.'; end if;
    if coalesce(nullif(p_data->>'odometer','')::bigint,0)<v.odometer then raise exception 'Os quilómetros não podem diminuir.'; end if;
    update public.rh_fleet_vehicles set plate=v_plate,make_model=trim(p_data->>'make_model'),cartrack_number=coalesce(trim(p_data->>'cartrack_number'),''),company=coalesce(trim(p_data->>'company'),''),habitual_person_id=v_holder,
      odometer=coalesce(nullif(p_data->>'odometer','')::bigint,0),insurance_until=nullif(p_data->>'insurance_until','')::date,inspection_until=nullif(p_data->>'inspection_until','')::date,transport_until=nullif(p_data->>'transport_until','')::date,
      active=coalesce((p_data->>'active')::boolean,true),version=version+1,updated_at=now() where id=p_id returning * into v;
  end if;
  return v;
end; $$;

create or replace function public.rh_fleet_save_handover(p_id uuid,p_vehicle_id uuid,p_version integer,p_expected_custody_id uuid,p_data jsonb)
returns public.rh_fleet_handovers language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir a frota.' using errcode='42501'; end if;
  if p_data->>'kind' not in ('initial','temporary','permanent','return') then raise exception 'Operação inválida.'; end if;
  if p_version=0 then
    insert into public.rh_fleet_handovers(id,vehicle_id,data,expected_custody_id,created_by) values(p_id,p_vehicle_id,p_data,p_expected_custody_id,auth.uid())
    on conflict(id) do nothing returning * into h;
    if h.id is null then select * into h from public.rh_fleet_handovers where id=p_id; end if;
  else
    select * into h from public.rh_fleet_handovers where id=p_id;
    if h.status='draft' and h.vehicle_id=p_vehicle_id and h.data=p_data and h.expected_custody_id is not distinct from p_expected_custody_id then return h; end if;
    update public.rh_fleet_handovers set data=p_data,expected_custody_id=p_expected_custody_id,version=version+1,updated_at=now()
    where id=p_id and vehicle_id=p_vehicle_id and version=p_version and status='draft' returning * into h;
    if h.id is null then raise exception 'O auto mudou entretanto. Atualiza a frota antes de continuar.'; end if;
  end if;
  return h;
end; $$;

create or replace function public.rh_fleet_confirm_handover(p_id uuid,p_version integer)
returns public.rh_fleet_handovers language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers; v public.rh_fleet_vehicles; c public.rh_fleet_custody;
  d jsonb; s jsonb; p public.rh_persons; giver public.rh_persons; at_time timestamptz; km bigint; item text; val text;
  inspection_keys text[]:=array['doc_dua','doc_contract','doc_manual','doc_service','doc_fuel','doc_toll','doc_cartrack','doc_other1','doc_other2',
    'glass_front','glass_lf','glass_rf','glass_lr','glass_rr','glass_back','glass_mirror_l','glass_mirror_r','glass_light_f','glass_light_r','glass_side','glass_other',
    'eq_radio','eq_mirror','eq_triangle','eq_vest','eq_jack','eq_wrench','eq_spare','eq_rack','eq_wheels','eq_caps','eq_roof','eq_stickers','eq_antenna','eq_other',
    'int_roof','int_driver','int_passenger','int_back','int_mats','int_other','level_engine','level_brake','level_water','level_tyres','level_other1','level_other2',
    'body_bumper_f','body_grill','body_hood','body_roof','body_left','body_right','body_back','body_bumper_r','body_sill_r','body_sill_l','body_other1','body_other2',
    'cargo_left','cargo_right','cargo_back','cargo_front','cargo_floor','cargo_stand','cargo_middle','cargo_tail','cargo_lights','cargo_other1','cargo_other2','cargo_other3'];
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir a frota.' using errcode='42501'; end if;
  -- Always lock the vehicle before the handover: concurrent handovers serialize.
  select vehicle_id into v.id from public.rh_fleet_handovers where id=p_id;
  select * into v from public.rh_fleet_vehicles where id=v.id for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.id is null then raise exception 'Auto não encontrado.'; end if;
  if h.status='confirmed' then return h; end if;
  if h.status<>'draft' or h.version<>p_version then raise exception 'O auto mudou entretanto. Atualiza a frota.'; end if;
  if not v.active then raise exception 'A viatura está arquivada.'; end if;
  d:=h.data;
  select * into c from public.rh_fleet_custody where vehicle_id=v.id and to_at is null for update;
  if c.id is distinct from h.expected_custody_id then raise exception 'A viatura foi entregue a outra pessoa entretanto. Revê a operação.'; end if;
  if nullif(trim(d->>'place'),'') is null or length(d->>'place')>120 or nullif(trim(d->>'reason'),'') is null then raise exception 'Indica local e motivo.'; end if;
  at_time:=nullif(d->>'at','')::timestamptz; km:=nullif(d->>'odometer','')::bigint;
  if at_time is null or at_time>now() then raise exception 'Só podes confirmar uma entrega já realizada. Mantém as futuras em rascunho.'; end if;
  if (c.id is not null and at_time<=c.from_at) or exists(select 1 from public.rh_fleet_custody where vehicle_id=v.id and coalesce(to_at,from_at)>at_time) then raise exception 'A hora da operação sobrepõe-se ao histórico existente.'; end if;
  if km is null or km<v.odometer or km>99999999 then raise exception 'Confirma os quilómetros; não podem diminuir.'; end if;
  if d->>'fuel' not in ('Reserva','1/4','1/2','3/4','Cheio') or d->>'fuel' is null then raise exception 'Confirma o combustível.'; end if;
  if d->>'kind' not in ('initial','temporary','permanent','return') or d->>'kind' is null then raise exception 'Operação inválida.'; end if;
  if d->>'kind'='initial' and c.id is not null then raise exception 'A viatura já tem um responsável. Regista uma passagem.'; end if;
  if d->>'kind' in ('temporary','return') and c.id is null then raise exception 'A viatura não tem uma entrega em curso.'; end if;
  if d->>'kind'<>'return' then
    select * into p from public.rh_persons where id=d->>'to_person_id';
    if p.id is null or p.id=c.person_id or (p.entrada is not null and p.entrada>(at_time at time zone 'Europe/Lisbon')::date) or
      (p.saida is not null and p.saida<(at_time at time zone 'Europe/Lisbon')::date) or (not p.ativo and p.saida is null) then raise exception 'Seleciona um colaborador elegível, diferente de quem entrega.'; end if;
  end if;
  if d->>'kind'='temporary' and (nullif(d->>'expected_return','') is null or (d->>'expected_return')::timestamptz<=at_time) then raise exception 'Indica uma devolução prevista posterior à entrega.'; end if;
  foreach item in array inspection_keys loop
    val:=d->'inspection'->>item;
    if val is null or val not in ('Bom','Suf','Mau','NE','NA') or (item like 'body_%' or item like 'cargo_%') and val='NE' then raise exception 'Completa todos os itens da inspeção, incluindo os não aplicáveis.'; end if;
  end loop;
  if exists(select 1 from jsonb_each_text(d->'inspection') where value='Mau') and nullif(trim(d->>'damage_notes'),'') is null then raise exception 'Justifica as anomalias assinaladas como Mau.'; end if;
  if coalesce((d->>'checked')::boolean,false) is not true then raise exception 'Confirma que verificaste a entrega real e os dados da inspeção.'; end if;
  if length(coalesce(d->>'notes',''))>2000 or length(coalesce(d->>'damage_notes',''))>3000 or nullif(trim(d->>'zone_name'),'') is null then raise exception 'Confirma as observações e o responsável de zona.'; end if;
  if c.id is not null then select * into giver from public.rh_persons where id=c.person_id; end if;
  s:=jsonb_build_object('template_version',1,'vehicle',to_jsonb(v),'from_person',jsonb_build_object('id',c.person_id,'name',coalesce(c.person_name,'Empresa / parque'),'phone',coalesce(giver.data->>'telefone',''),'number',coalesce(giver.data->>'numero','')),
    'to_person',jsonb_build_object('id',p.id,'name',coalesce(p.name,'Empresa / parque'),'phone',coalesce(p.data->>'telefone',''),'number',coalesce(p.data->>'numero','')),'operation',d,'captured_at',now());
  if c.id is not null then update public.rh_fleet_custody set to_at=at_time where id=c.id; end if;
  if d->>'kind'<>'return' then insert into public.rh_fleet_custody(vehicle_id,person_id,person_name,from_at,handover_id) values(v.id,p.id,p.name,at_time,h.id); end if;
  update public.rh_fleet_vehicles set odometer=km,habitual_person_id=case when d->>'kind' in ('initial','permanent') then p.id else habitual_person_id end,version=version+1,updated_at=now() where id=v.id;
  update public.rh_fleet_handovers set snapshot=s,status='confirmed',confirmed_by=auth.uid(),confirmed_at=now(),updated_at=now(),version=version+1 where id=h.id returning * into h;
  return h;
end; $$;

create or replace function public.rh_fleet_cancel_handover(p_id uuid,p_version integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode gerir a frota.' using errcode='42501'; end if;
  update public.rh_fleet_handovers set status='cancelled',version=version+1,updated_at=now() where id=p_id and version=p_version and status='draft';
  if not found then raise exception 'O auto já foi alterado ou confirmado.'; end if;
  return true;
end; $$;

revoke all on function public.rh_fleet_version(),public.rh_fleet_save_vehicle(uuid,integer,jsonb),public.rh_fleet_save_handover(uuid,uuid,integer,uuid,jsonb),public.rh_fleet_confirm_handover(uuid,integer),public.rh_fleet_cancel_handover(uuid,integer) from public,anon;
grant execute on function public.rh_fleet_version(),public.rh_fleet_save_vehicle(uuid,integer,jsonb),public.rh_fleet_save_handover(uuid,uuid,integer,uuid,jsonb),public.rh_fleet_confirm_handover(uuid,integer),public.rh_fleet_cancel_handover(uuid,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rh-fleet','rh-fleet',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false;
drop policy if exists rh_fleet_private_read on storage.objects;
create policy rh_fleet_private_read on storage.objects for select to authenticated using(bucket_id='rh-fleet' and public.is_rh_admin());
drop policy if exists rh_fleet_private_upload on storage.objects;
create policy rh_fleet_private_upload on storage.objects for insert to authenticated with check(bucket_id='rh-fleet' and public.is_rh_admin()
  and exists(select 1 from public.rh_fleet_handovers h where h.id::text=split_part(name,'/',1)));
-- No UPDATE/DELETE policy: archived files cannot be overwritten by the browser.
notify pgrst,'reload schema';
commit;
