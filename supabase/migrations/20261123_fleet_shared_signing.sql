begin;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated;
create table if not exists rh_release_backups.fleet_shared_signing_20261123(entity text primary key,payload jsonb not null);
alter table rh_release_backups.fleet_shared_signing_20261123 enable row level security;
revoke all on rh_release_backups.fleet_shared_signing_20261123 from public,anon,authenticated;
do $$ declare tab text;begin
  foreach tab in array array['rh_fleet_handovers','rh_fleet_share_links','rh_fleet_signature_receipts'] loop
    execute format('insert into rh_release_backups.fleet_shared_signing_20261123 values (%L,(select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t)) on conflict do nothing',tab,tab);
  end loop;
end; $$;
alter table public.rh_fleet_share_links add column if not exists shared_signing boolean not null default false;
alter table public.rh_fleet_share_links add column if not exists shared_submitted_at timestamptz;
-- Each party has its own receipt, including when both use the same private link.
alter table public.rh_fleet_signature_receipts drop constraint if exists rh_fleet_signature_receipts_link_id_key;
create unique index if not exists fleet_receipt_link_party on public.rh_fleet_signature_receipts(link_id,purpose);

create or replace function public.rh_fleet_read_shared_share(p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;payload jsonb;receipts jsonb;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  if l.id is null or not l.shared_signing or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Ligação inválida, cancelada ou expirada.';end if;
  select * into h from public.rh_fleet_handovers where id=l.handover_id;
  if h.id is null or h.status not in ('draft','confirmed') then raise exception 'Este auto já não está disponível.';end if;
  if h.status='confirmed' then return jsonb_build_object('shared_signing',true,'status','closed','number',h.number,'expires_at',l.expires_at);end if;
  payload:=public.rh_fleet_sign_payload(h.id);
  if l.shared_submitted_at is not null then
    select * into s from public.rh_fleet_sign_sessions where handover_id=h.id;
    if s.handover_id is null or not s.active or not s.required or s.content_hash is distinct from l.content_hash or public.rh_fleet_doc_hash(h.id) is distinct from l.content_hash then raise exception 'O auto foi alterado. Pede uma nova ligação ao RH.';end if;
  end if;
  select coalesce(jsonb_object_agg(r.purpose,jsonb_build_object('id',r.id,'signer_name',r.signer_name,'signed_at',r.signed_at)), '{}') into receipts
    from public.rh_fleet_signature_receipts r where r.handover_id=h.id and r.invalidated_at is null and r.content_hash=l.content_hash;
  return jsonb_build_object('link_id',l.id,'shared_signing',true,'purpose',case when l.shared_submitted_at is null then 'editor' else 'both' end,
    'status',case when receipts ? 'from' and receipts ? 'to' then 'complete' else 'open' end,'expires_at',l.expires_at,'content_hash',l.content_hash,
    'number',h.number,'handover',jsonb_build_object('id',h.id,'vehicle_id',h.vehicle_id,'status',h.status,'version',h.version,'expected_custody_id',h.expected_custody_id,'data',h.data-'signatures'-'signature_receipts'),
    'payload',payload,'receipts',receipts,'signing_at',s.created_at);
end; $$;
do $$ begin
  if to_regprocedure('public.rh_fleet_read_share_before_shared(text)') is null then alter function public.rh_fleet_read_share(text) rename to rh_fleet_read_share_before_shared;end if;
end; $$;
create or replace function public.rh_fleet_read_share(p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.rh_fleet_share_links where token_hash=p_hash and shared_signing) then return public.rh_fleet_read_shared_share(p_hash);end if;
  return public.rh_fleet_read_share_before_shared(p_hash);
end; $$;
do $$ begin
  if to_regprocedure('public.rh_fleet_share_status_before_shared(uuid)') is null then alter function public.rh_fleet_share_status(uuid) rename to rh_fleet_share_status_before_shared;end if;
end; $$;
create or replace function public.rh_fleet_share_status(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  result:=public.rh_fleet_share_status_before_shared(p_id);
  return result||jsonb_build_object('links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'purpose',case when shared_signing and shared_submitted_at is not null then 'both' else purpose end,'shared_signing',shared_signing,'expires_at',expires_at,'revoked_at',revoked_at,'used_at',case when shared_signing then null else used_at end,'created_at',created_at) order by created_at desc) from public.rh_fleet_share_links where handover_id=p_id),'[]'));
end; $$;

create or replace function public.rh_fleet_create_shared_share(p_id uuid,p_editable boolean,p_hash text,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;l public.rh_fleet_share_links;v uuid;payload jsonb;fingerprint text;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode criar ligações.' using errcode='42501';end if;
  if p_editable is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_expires is null or p_expires<=now() or p_expires>now()+interval '31 days' then raise exception 'Finalidade ou validade inválida.';end if;
  select vehicle_id into v from public.rh_fleet_handovers where id=p_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.id is null or h.status<>'draft' then raise exception 'Só podes partilhar autos em rascunho.';end if;
  if p_editable then
    perform public.rh_fleet_create_share(p_id,'editor',p_hash,least(p_expires,now()+interval '24 hours'));
    update public.rh_fleet_share_links set shared_signing=true,expires_at=p_expires where token_hash=p_hash returning * into l;
  else
    payload:=public.rh_fleet_sign_payload(p_id);fingerprint:=public.rh_fleet_doc_hash(p_id);
    select * into s from public.rh_fleet_sign_sessions where handover_id=p_id for update;
    if s.handover_id is null or not s.active or not s.required or s.content_hash is distinct from fingerprint then
      perform public.rh_fleet_archive_signatures(h);
      update public.rh_fleet_signature_receipts set invalidated_at=coalesce(invalidated_at,now()) where handover_id=p_id;
      update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id;
      update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}','{}'),'{signature_receipts}','{}'),version=version+1,updated_at=now() where id=p_id;
      insert into public.rh_fleet_sign_sessions(handover_id,content_hash,payload) values(p_id,fingerprint,payload)
      on conflict(handover_id) do update set content_hash=excluded.content_hash,payload=excluded.payload,required=true,active=true,created_at=now();
    end if;
    update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and purpose='editor' and shared_submitted_at is null;
    insert into public.rh_fleet_share_links(handover_id,purpose,token_hash,content_hash,expires_at,created_by,shared_signing,shared_submitted_at)
      values(p_id,'editor',p_hash,fingerprint,p_expires,auth.uid(),true,now()) returning * into l;
  end if;
  return jsonb_build_object('id',l.id,'purpose',case when p_editable then 'editor' else 'both' end,'shared_signing',true,'expires_at',l.expires_at);
end; $$;

create or replace function public.rh_fleet_submit_shared(p_hash text,p_version integer,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;v uuid;patch jsonb;payload jsonb;fingerprint text;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  select vehicle_id into v from public.rh_fleet_handovers where id=l.handover_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=l.handover_id for update;
  select * into l from public.rh_fleet_share_links where token_hash=p_hash for update;
  if l.id is null or not l.shared_signing or l.revoked_at is not null or l.expires_at<=now() or h.status<>'draft' then raise exception 'A ligação de preenchimento já não está disponível.';end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>1000000 then raise exception 'Dados inválidos.';end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into patch from jsonb_each(p_patch) where key in ('at','expected_return','odometer','fuel','place','inspection','damage_markers','damage_notes','notes','driver_fields','checked');
  if l.shared_submitted_at is not null then
    if (h.data||patch) is distinct from h.data then raise exception 'O preenchimento já foi concluído. O conteúdo assinado não pode ser alterado por esta ligação.';end if;
    return public.rh_fleet_read_shared_share(p_hash);
  end if;
  if l.purpose<>'editor' then raise exception 'Esta ligação não permite preencher.';end if;
  perform public.rh_fleet_remote_save(p_hash,p_version,patch,false);
  select * into h from public.rh_fleet_handovers where id=l.handover_id;
  payload:=public.rh_fleet_sign_payload(h.id);fingerprint:=public.rh_fleet_doc_hash(h.id);
  perform public.rh_fleet_archive_signatures(h);
  update public.rh_fleet_signature_receipts set invalidated_at=coalesce(invalidated_at,now()) where handover_id=h.id;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=h.id and id<>l.id;
  update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}','{}'),'{signature_receipts}','{}'),version=version+1,updated_at=now() where id=h.id;
  insert into public.rh_fleet_sign_sessions(handover_id,content_hash,payload) values(h.id,fingerprint,payload)
    on conflict(handover_id) do update set content_hash=excluded.content_hash,payload=excluded.payload,required=true,active=true,created_at=now();
  update public.rh_fleet_share_links set content_hash=fingerprint,shared_submitted_at=now() where id=l.id;
  return public.rh_fleet_read_shared_share(p_hash);
end; $$;

create or replace function public.rh_fleet_remote_shared_sign(p_hash text,p_role text,p_name text,p_signature text,p_content_hash text,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;r public.rh_fleet_signature_receipts;receipt jsonb;fingerprint text;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  select * into h from public.rh_fleet_handovers where id=l.handover_id for update;
  select * into l from public.rh_fleet_share_links where token_hash=p_hash for update;
  if l.id is null or not l.shared_signing or l.shared_submitted_at is null or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Ligação de assinatura inválida, cancelada ou expirada.';end if;
  if p_role is null or p_role not in ('from','to') then raise exception 'Seleciona o campo da tua assinatura.';end if;
  if p_accept is not true or p_name is null or length(trim(p_name)) not between 2 and 120 or p_name ~ '[[:cntrl:]]' or p_signature is null or length(p_signature) not between 100 and 180000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Confirma o teu nome, a assinatura e a aceitação do auto.';end if;
  select * into s from public.rh_fleet_sign_sessions where handover_id=h.id for update;
  fingerprint:=public.rh_fleet_doc_hash(h.id);
  if h.status<>'draft' or s.handover_id is null or not s.active or not s.required or s.content_hash is distinct from l.content_hash or fingerprint is distinct from p_content_hash or fingerprint is distinct from l.content_hash then raise exception 'O auto foi alterado ou fechado. Pede uma nova ligação ao RH.';end if;
  select * into r from public.rh_fleet_signature_receipts where handover_id=h.id and purpose=p_role and invalidated_at is null and content_hash=fingerprint;
  if r.id is not null then
    if r.link_id=l.id and r.signer_name=trim(p_name) and r.signature_hash=encode(sha256(convert_to(p_signature,'UTF8')),'hex') then return public.rh_fleet_read_shared_share(p_hash);end if;
    raise exception 'Este campo já tem uma assinatura guardada. Reabre a ligação para consultar o estado.';
  end if;
  insert into public.rh_fleet_signature_receipts(handover_id,link_id,purpose,content_hash,signer_name,signature_hash)
    values(h.id,l.id,p_role,fingerprint,trim(p_name),encode(sha256(convert_to(p_signature,'UTF8')),'hex')) returning * into r;
  receipt:=jsonb_build_object('id',r.id,'signer_name',r.signer_name,'signed_at',r.signed_at,'content_hash',r.content_hash,'method','screen');
  update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}',coalesce(data->'signatures','{}')||jsonb_build_object(p_role,p_signature)),'{signature_receipts}',coalesce(data->'signature_receipts','{}')||jsonb_build_object(p_role,receipt)),version=version+1,updated_at=now() where id=h.id;
  return public.rh_fleet_read_shared_share(p_hash);
end; $$;

-- An old admin form cannot erase a receipt that still covers the same content.
create or replace function public.rh_fleet_preserve_receipted_signatures() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rh_fleet_signature_receipts;drawing text;receipt jsonb;images jsonb;receipts jsonb;
begin
  if old.status<>'draft' or (old.data-'signatures'-'signature_receipts'-'checked') is distinct from (new.data-'signatures'-'signature_receipts'-'checked') then return new;end if;
  for r in select sr.* from public.rh_fleet_signature_receipts sr join public.rh_fleet_sign_sessions s on s.handover_id=sr.handover_id and s.content_hash=sr.content_hash where sr.handover_id=old.id and sr.invalidated_at is null and s.active and s.required loop
    drawing:=new.data->'signatures'->>r.purpose;
    if encode(sha256(convert_to(drawing,'UTF8')),'hex') is distinct from r.signature_hash then drawing:=old.data->'signatures'->>r.purpose;end if;
    if encode(sha256(convert_to(drawing,'UTF8')),'hex') is distinct from r.signature_hash then select signature into drawing from public.rh_fleet_signature_archive where receipt_id=r.id and signature_hash=r.signature_hash and content_hash=r.content_hash;end if;
    if encode(sha256(convert_to(drawing,'UTF8')),'hex') is distinct from r.signature_hash then raise exception 'A assinatura guardada não está disponível. Atualiza as assinaturas antes de guardar.';end if;
    images:=case when jsonb_typeof(new.data->'signatures')='object' then new.data->'signatures' else '{}' end;
    receipts:=case when jsonb_typeof(new.data->'signature_receipts')='object' then new.data->'signature_receipts' else '{}' end;
    receipt:=jsonb_build_object('id',r.id,'signer_name',r.signer_name,'signed_at',r.signed_at,'content_hash',r.content_hash,'method',case when r.reconfirmed_from is null then 'screen' else 'screen_reconfirmed' end);
    if r.reconfirmed_from is not null then receipt:=receipt||jsonb_build_object('previous_receipt_id',r.reconfirmed_from);end if;
    new.data:=jsonb_set(jsonb_set(new.data,'{signatures}',images||jsonb_build_object(r.purpose,drawing)),'{signature_receipts}',receipts||jsonb_build_object(r.purpose,receipt));
  end loop;
  return new;
end; $$;
drop trigger if exists zz_fleet_preserve_receipted_signatures on public.rh_fleet_handovers;
create trigger zz_fleet_preserve_receipted_signatures before update of data on public.rh_fleet_handovers for each row execute function public.rh_fleet_preserve_receipted_signatures();

-- Existing unexpired links for a draft can also be forwarded to the other party.
update public.rh_fleet_share_links l set shared_signing=true,shared_submitted_at=case when l.purpose in ('from','to') then l.created_at else null end
  from public.rh_fleet_handovers h where h.id=l.handover_id and h.status='draft' and not l.shared_signing and l.revoked_at is null and l.expires_at>now()
    and ((l.purpose in ('from','to') and exists(select 1 from public.rh_fleet_sign_sessions s where s.handover_id=h.id and s.active and s.required and s.content_hash=l.content_hash))
      or (l.purpose='editor' and l.used_at is null and not exists(select 1 from public.rh_fleet_sign_sessions s where s.handover_id=h.id and s.active and s.required)));
revoke all on function public.rh_fleet_read_share_before_shared(text),public.rh_fleet_share_status_before_shared(uuid),public.rh_fleet_preserve_receipted_signatures() from public,anon,authenticated,service_role;
revoke all on function public.rh_fleet_share_status(uuid) from public,anon;
grant execute on function public.rh_fleet_share_status(uuid) to authenticated;
revoke all on function public.rh_fleet_read_shared_share(text),public.rh_fleet_read_share(text),public.rh_fleet_submit_shared(text,integer,jsonb),public.rh_fleet_remote_shared_sign(text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.rh_fleet_read_shared_share(text),public.rh_fleet_read_share(text),public.rh_fleet_submit_shared(text,integer,jsonb),public.rh_fleet_remote_shared_sign(text,text,text,text,text,boolean) to service_role;
revoke all on function public.rh_fleet_create_shared_share(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.rh_fleet_create_shared_share(uuid,boolean,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
