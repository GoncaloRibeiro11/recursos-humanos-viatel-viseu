begin;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated;
create table if not exists rh_release_backups.fleet_giver_absence_20261120(entity text primary key,payload jsonb not null);
alter table rh_release_backups.fleet_giver_absence_20261120 enable row level security;
revoke all on rh_release_backups.fleet_giver_absence_20261120 from public,anon,authenticated;
do $$ declare tab text;begin
  foreach tab in array array['rh_fleet_handovers','rh_fleet_vehicles','rh_fleet_custody','rh_fleet_signature_receipts'] loop
    execute format('insert into rh_release_backups.fleet_giver_absence_20261120 values (%L,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t)) on conflict do nothing',tab,tab);
  end loop;
  insert into rh_release_backups.fleet_giver_absence_20261120 values('finish_function',to_jsonb(pg_get_functiondef('public.rh_fleet_finish_handover(uuid,integer,text)'::regprocedure))) on conflict do nothing;
end; $$;

-- Missing signatures are administrative declarations, never substituted consent.
create or replace function public.rh_fleet_confirm_with_absences(p_id uuid,p_version integer,p_absences jsonb)
returns public.rh_fleet_handovers language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;v uuid;external boolean;content text;party text;reason text;absences jsonb:='{}';
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode confirmar entregas.' using errcode='42501';end if;
  select vehicle_id into v from public.rh_fleet_handovers where id=p_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.id is null then raise exception 'Auto não encontrado.';end if;
  if h.status='confirmed' then return h;end if;
  if h.status<>'draft' or h.version is distinct from p_version then raise exception 'O auto mudou entretanto. Atualiza as assinaturas antes de confirmar.';end if;
  if jsonb_typeof(p_absences) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_absences) k where k not in ('from','to')) then raise exception 'Declara apenas as assinaturas não recolhidas de quem entrega e de quem recebe.';end if;
  foreach party in array array['from','to'] loop
    if p_absences ? party then
      reason:=trim(p_absences->>party);
      if jsonb_typeof(p_absences->party) is distinct from 'string' or length(reason) not between 8 and 500 or reason ~ '[[:cntrl:]]' then raise exception 'Indica o motivo da assinatura não recolhida (8 a 500 caracteres).';end if;
    end if;
  end loop;
  if p_absences<>'{}'::jsonb and not exists(select 1 from storage.objects where bucket_id='rh-fleet' and name like p_id::text||'/%' and name ~* '\.(jpe?g|png|webp)$') then raise exception 'Anexa pelo menos uma fotografia da viatura antes de confirmar.';end if;
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
  content:=public.rh_fleet_doc_hash(p_id);
  if s.required and (not s.active or content is distinct from s.content_hash) then raise exception 'O conteúdo mudou. Pede novas assinaturas antes de confirmar.';end if;
  foreach party in array array['from','to'] loop
    if p_absences ? party then
      if exists(select 1 from public.rh_fleet_signature_receipts where handover_id=p_id and purpose=party and invalidated_at is null and content_hash=content) then raise exception 'Quem % já assinou este conteúdo. Mantém a assinatura existente.',case when party='from' then 'entrega' else 'recebe' end;end if;
      absences:=absences||jsonb_build_object(party,jsonb_build_object('status','not_collected','reason',trim(p_absences->>party),'recorded_by',auth.uid(),'recorded_at',now(),'content_hash',content));
    elsif s.required and (not exists(select 1 from public.rh_fleet_signature_receipts where handover_id=p_id and purpose=party and content_hash=content and invalidated_at is null)
      or h.data->'signature_receipts'->party->>'content_hash' is distinct from content) then
      raise exception 'Faltam assinaturas válidas. Recolhe a assinatura de quem % ou declara explicitamente que não foi recolhida.',case when party='from' then 'entrega' else 'recebe' end;
    end if;
  end loop;
  if s.required then
    if exists(select 1 from public.rh_fleet_signature_receipts r where r.handover_id=p_id and r.content_hash=content and r.invalidated_at is null and r.signature_hash is distinct from encode(sha256(convert_to(h.data->'signatures'->>r.purpose,'UTF8')),'hex')) then raise exception 'A imagem de uma assinatura foi alterada. Pede novas assinaturas.';end if;
  end if;
  h:=public.rh_fleet_confirm_handover_v1(p_id,p_version);
  if absences<>'{}'::jsonb then update public.rh_fleet_handovers set snapshot=snapshot||jsonb_build_object('signature_absences',absences) where id=p_id returning * into h;end if;
  if external then
    update public.rh_fleet_handovers set snapshot=jsonb_set(snapshot,'{to_person}',jsonb_build_object('id',null,'name',data->'driver_fields'->'to'->>'name','phone',coalesce(data->'driver_fields'->'to'->>'phone',''),'number',coalesce(data->'driver_fields'->'to'->>'number',''),'structure',data->>'external_structure')) where id=p_id returning * into h;
    update public.rh_fleet_vehicles set active=false,habitual_person_id=null,version=version+1,updated_at=now() where id=v;
  end if;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and used_at is null;
  return h;
end; $$;
create or replace function public.rh_fleet_finish_handover(p_id uuid,p_version integer,p_absence_reason text)
returns public.rh_fleet_handovers language sql security definer set search_path=public,pg_temp as $$
  select public.rh_fleet_confirm_with_absences(p_id,p_version,case when p_absence_reason is null then '{}'::jsonb else jsonb_build_object('to',p_absence_reason) end);
$$;
revoke all on function public.rh_fleet_confirm_with_absences(uuid,integer,jsonb) from public,anon;
grant execute on function public.rh_fleet_confirm_with_absences(uuid,integer,jsonb) to authenticated;
revoke all on function public.rh_fleet_finish_handover(uuid,integer,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
