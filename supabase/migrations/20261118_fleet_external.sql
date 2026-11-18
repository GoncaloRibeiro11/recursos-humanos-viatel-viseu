begin;
create or replace function public.rh_fleet_sign_payload(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;v public.rh_fleet_vehicles;c public.rh_fleet_custody;f public.rh_persons;t public.rh_persons;recipient jsonb;
begin
  select * into h from public.rh_fleet_handovers where id=p_id;
  if h.id is null then raise exception 'Auto indisponível.';end if;
  select * into v from public.rh_fleet_vehicles where id=h.vehicle_id;
  select * into c from public.rh_fleet_custody where vehicle_id=v.id and to_at is null;
  if h.expected_custody_id is distinct from c.id then raise exception 'A viatura mudou de responsável. Revê o auto no RH.';end if;
  select * into f from public.rh_persons where id=c.person_id;
  select * into t from public.rh_persons where id=h.data->>'to_person_id' and h.data->>'kind'<>'return';
  recipient:=jsonb_build_object('id',t.id,'name',coalesce(t.name,'Empresa / parque'),'phone',coalesce(t.data->>'telefone',''),'number',coalesce(t.data->>'numero',''));
  if h.data->>'destination'='external_structure' then
    recipient:=jsonb_build_object('id',null,'name',h.data->'driver_fields'->'to'->>'name','phone',coalesce(h.data->'driver_fields'->'to'->>'phone',''),'number',coalesce(h.data->'driver_fields'->'to'->>'number',''),'structure',h.data->>'external_structure');
  end if;
  return jsonb_build_object('template_version',1,'handover_id',h.id,'vehicle',jsonb_build_object('id',v.id,'plate',v.plate,'make_model',v.make_model,'cartrack_number',v.cartrack_number,'company',v.company,'odometer',v.odometer,'insurance_until',v.insurance_until,'inspection_until',v.inspection_until,'transport_until',v.transport_until),
    'from_person',jsonb_build_object('id',c.person_id,'name',coalesce(c.person_name,'Empresa / parque'),'phone',coalesce(f.data->>'telefone',''),'number',coalesce(f.data->>'numero','')),
    'to_person',recipient,'operation',h.data-'signatures'-'signature_receipts'-'checked',
    'photos',coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o where o.bucket_id='rh-fleet' and split_part(o.name,'/',1)=h.id::text and o.name ~* '\.(jpg|jpeg|png|webp)$'),'[]'::jsonb));
end; $$;

create or replace function public.rh_fleet_confirm_handover(p_id uuid,p_version integer)
returns public.rh_fleet_handovers language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;v uuid;external boolean;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode confirmar entregas.' using errcode='42501';end if;
  select vehicle_id into v from public.rh_fleet_handovers where id=p_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.status='confirmed' then return h;end if;
  external:=coalesce(h.data->>'destination'='external_structure',false);
  if external and (h.data->>'kind'<>'return' or h.data->>'kind' is null
    or jsonb_typeof(h.data->'external_structure') is distinct from 'string'
    or jsonb_typeof(h.data->'driver_fields'->'to'->'name') is distinct from 'string'
    or coalesce(length(trim(h.data->>'external_structure')),0) not between 2 and 120
    or coalesce(length(trim(h.data->'driver_fields'->'to'->>'name')),0) not between 2 and 120
    or h.data->>'external_structure' ~ '[[:cntrl:]]' or h.data->'driver_fields'->'to'->>'name' ~ '[[:cntrl:]]') then
    raise exception 'Indica a estrutura de destino e o nome de quem recebe. A entrega externa tem de encerrar a utilização atual.';
  end if;
  select * into s from public.rh_fleet_sign_sessions where handover_id=p_id for update;
  if s.required then
    if not s.active or public.rh_fleet_doc_hash(p_id)<>s.content_hash or (select count(distinct purpose) from public.rh_fleet_signature_receipts where handover_id=p_id and content_hash=s.content_hash and invalidated_at is null)<>2 then raise exception 'Faltam assinaturas válidas de quem entrega e de quem recebe/devolve.';end if;
    if h.data->'signature_receipts'->'from'->>'content_hash' is distinct from s.content_hash or h.data->'signature_receipts'->'to'->>'content_hash' is distinct from s.content_hash then raise exception 'As assinaturas do auto foram alteradas. Pede novas assinaturas.';end if;
    if exists(select 1 from public.rh_fleet_signature_receipts r where r.handover_id=p_id and r.content_hash=s.content_hash and r.invalidated_at is null and r.signature_hash is distinct from encode(sha256(convert_to(h.data->'signatures'->>r.purpose,'UTF8')),'hex')) then raise exception 'A imagem de uma assinatura foi alterada. Pede novas assinaturas.';end if;
  end if;
  h:=public.rh_fleet_confirm_handover_v1(p_id,p_version);
  if external then
    update public.rh_fleet_handovers set snapshot=jsonb_set(snapshot,'{to_person}',jsonb_build_object('id',null,'name',data->'driver_fields'->'to'->>'name','phone',coalesce(data->'driver_fields'->'to'->>'phone',''),'number',coalesce(data->'driver_fields'->'to'->>'number',''),'structure',data->>'external_structure')) where id=p_id returning * into h;
    update public.rh_fleet_vehicles set active=false,habitual_person_id=null,version=version+1,updated_at=now() where id=v;
  end if;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and used_at is null;
  return h;
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
    or exists(select 1 from public.rh_fleet_handovers where expected_custody_id in (select id from public.rh_fleet_custody where vehicle_id=p_id)) then
    raise exception 'A viatura tem autos ou histórico. Regista a saída e arquiva-a; não pode ser eliminada como teste.';
  end if;
  delete from public.rh_fleet_custody where vehicle_id=p_id and origin='initial_state';
  delete from public.rh_fleet_vehicles where id=p_id;
  return true;
end; $$;
revoke all on function public.rh_fleet_sign_payload(uuid) from public,anon,authenticated;
revoke all on function public.rh_fleet_confirm_handover(uuid,integer),public.rh_fleet_delete_unused_vehicle(uuid,integer,text) from public,anon;
grant execute on function public.rh_fleet_confirm_handover(uuid,integer),public.rh_fleet_delete_unused_vehicle(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
