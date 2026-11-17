begin;
create table if not exists public.rh_fleet_sign_sessions (
  handover_id uuid primary key references public.rh_fleet_handovers(id),
  content_hash text not null, payload jsonb not null,
  required boolean not null default true, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.rh_fleet_share_links (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.rh_fleet_handovers(id),
  purpose text not null check(purpose in ('editor','from','to')),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  content_hash text,
  expires_at timestamptz not null, revoked_at timestamptz, used_at timestamptz,
  created_by uuid not null, created_at timestamptz not null default now()
);
create table if not exists public.rh_fleet_signature_receipts (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.rh_fleet_handovers(id),
  link_id uuid not null unique references public.rh_fleet_share_links(id),
  purpose text not null check(purpose in ('from','to')),
  content_hash text not null, signer_name text not null,
  signature_hash text not null, signed_at timestamptz not null default now(),
  invalidated_at timestamptz
);
create index if not exists rh_fleet_share_handover on public.rh_fleet_share_links(handover_id);
alter table public.rh_fleet_sign_sessions enable row level security;
alter table public.rh_fleet_share_links enable row level security;
alter table public.rh_fleet_signature_receipts enable row level security;
revoke all on public.rh_fleet_sign_sessions,public.rh_fleet_share_links,public.rh_fleet_signature_receipts from public,anon,authenticated;
-- Raw tokens and their hashes are never exposed through table reads.
grant select on public.rh_fleet_sign_sessions,public.rh_fleet_signature_receipts to authenticated;
drop policy if exists fleet_admin_read on public.rh_fleet_sign_sessions;
create policy fleet_admin_read on public.rh_fleet_sign_sessions for select to authenticated using(public.is_rh_admin());
drop policy if exists fleet_admin_read on public.rh_fleet_signature_receipts;
create policy fleet_admin_read on public.rh_fleet_signature_receipts for select to authenticated using(public.is_rh_admin());

create or replace function public.rh_fleet_sign_payload(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;v public.rh_fleet_vehicles;c public.rh_fleet_custody;f public.rh_persons;t public.rh_persons;
begin
  select * into h from public.rh_fleet_handovers where id=p_id;
  if h.id is null then raise exception 'Auto indisponível.'; end if;
  select * into v from public.rh_fleet_vehicles where id=h.vehicle_id;
  select * into c from public.rh_fleet_custody where vehicle_id=v.id and to_at is null;
  if h.expected_custody_id is distinct from c.id then raise exception 'A viatura mudou de responsável. Revê o auto no RH.'; end if;
  select * into f from public.rh_persons where id=c.person_id;
  select * into t from public.rh_persons where id=h.data->>'to_person_id' and h.data->>'kind'<>'return';
  return jsonb_build_object('template_version',1,'handover_id',h.id,'vehicle',jsonb_build_object('id',v.id,'plate',v.plate,'make_model',v.make_model,'cartrack_number',v.cartrack_number,'company',v.company,'odometer',v.odometer,'insurance_until',v.insurance_until,'inspection_until',v.inspection_until,'transport_until',v.transport_until),
    'from_person',jsonb_build_object('id',c.person_id,'name',coalesce(c.person_name,'Empresa / parque'),'phone',coalesce(f.data->>'telefone',''),'number',coalesce(f.data->>'numero','')),
    'to_person',jsonb_build_object('id',t.id,'name',coalesce(t.name,'Empresa / parque'),'phone',coalesce(t.data->>'telefone',''),'number',coalesce(t.data->>'numero','')),
    'operation',h.data-'signatures'-'signature_receipts'-'checked',
    'photos',coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o where o.bucket_id='rh-fleet' and split_part(o.name,'/',1)=h.id::text and o.name ~* '\.(jpg|jpeg|png|webp)$'),'[]'::jsonb));
end; $$;

create or replace function public.rh_fleet_doc_hash(p_id uuid) returns text
language sql security definer set search_path=public,pg_temp as $$
  select encode(sha256(convert_to(public.rh_fleet_sign_payload(p_id)::text,'UTF8')),'hex');
$$;

create or replace function public.rh_fleet_create_share(p_id uuid,p_purpose text,p_hash text,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;l public.rh_fleet_share_links;v uuid;payload jsonb;fingerprint text;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode criar ligações.' using errcode='42501';end if;
  if p_purpose not in ('editor','from','to') or p_purpose is null or p_expires<=now() or p_expires>now()+interval '48 hours' then raise exception 'Finalidade ou validade inválida.';end if;
  select vehicle_id into v from public.rh_fleet_handovers where id=p_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  if h.id is null or h.status<>'draft' then raise exception 'Só podes partilhar autos em rascunho.';end if;
  payload:=public.rh_fleet_sign_payload(p_id);fingerprint:=public.rh_fleet_doc_hash(p_id);
  select * into s from public.rh_fleet_sign_sessions where handover_id=p_id for update;
  if p_purpose='editor' then
    if s.required and s.active then raise exception 'Cancela primeiro o pedido de assinaturas para voltar a preencher.';end if;
  else
    if s.required and s.active and s.content_hash=fingerprint and exists(select 1 from public.rh_fleet_signature_receipts where handover_id=p_id and purpose=p_purpose and invalidated_at is null and content_hash=fingerprint) then raise exception 'Esta pessoa já assinou esta versão.';end if;
    if s.handover_id is null or not s.active or s.content_hash<>fingerprint then
      update public.rh_fleet_signature_receipts set invalidated_at=coalesce(invalidated_at,now()) where handover_id=p_id;
      update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and purpose in ('from','to');
      update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}','{}'),'{signature_receipts}','{}'),version=version+1,updated_at=now() where id=p_id;
      insert into public.rh_fleet_sign_sessions(handover_id,content_hash,payload) values(p_id,fingerprint,payload)
      on conflict(handover_id) do update set content_hash=excluded.content_hash,payload=excluded.payload,required=true,active=true,created_at=now();
    end if;
    update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and purpose='editor';
  end if;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and purpose=p_purpose and revoked_at is null;
  insert into public.rh_fleet_share_links(handover_id,purpose,token_hash,content_hash,expires_at,created_by)
  values(p_id,p_purpose,p_hash,case when p_purpose='editor' then null else fingerprint end,p_expires,auth.uid()) returning * into l;
  return jsonb_build_object('id',l.id,'purpose',l.purpose,'expires_at',l.expires_at,'content_hash',l.content_hash);
end; $$;

create or replace function public.rh_fleet_prepare_share(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;c public.rh_fleet_custody;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode preparar ligações.' using errcode='42501';end if;
  select * into h from public.rh_fleet_handovers where id=p_id;
  if h.id is null then raise exception 'Auto indisponível.';end if;
  select * into c from public.rh_fleet_custody where vehicle_id=h.vehicle_id and to_at is null;
  return jsonb_build_object('handover',to_jsonb(h),'payload',public.rh_fleet_sign_payload(p_id),'holder',case when c.id is null then null else to_jsonb(c) end,'content_hash',public.rh_fleet_doc_hash(p_id));
end; $$;

create or replace function public.rh_fleet_share_status(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode consultar ligações.' using errcode='42501';end if;
  return jsonb_build_object('handover',(select to_jsonb(h) from public.rh_fleet_handovers h where id=p_id),'links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'purpose',purpose,'expires_at',expires_at,'revoked_at',revoked_at,'used_at',used_at,'created_at',created_at) order by created_at desc) from public.rh_fleet_share_links where handover_id=p_id),'[]'::jsonb),
    'session',(select to_jsonb(s)-'payload' from public.rh_fleet_sign_sessions s where handover_id=p_id),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r)-'signature_hash' order by signed_at) from public.rh_fleet_signature_receipts r where handover_id=p_id),'[]'::jsonb));
end; $$;

create or replace function public.rh_fleet_revoke_shares(p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode cancelar ligações.' using errcode='42501';end if;
  perform 1 from public.rh_fleet_handovers where id=p_id for update;
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id;
  update public.rh_fleet_sign_sessions set required=false,active=false where handover_id=p_id;
  update public.rh_fleet_signature_receipts set invalidated_at=coalesce(invalidated_at,now()) where handover_id=p_id;
  update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}','{}'),'{signature_receipts}','{}'),version=version+1,updated_at=now() where id=p_id and status='draft';
  return true;
end; $$;

create or replace function public.rh_fleet_read_share(p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;r public.rh_fleet_signature_receipts;payload jsonb;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  if l.id is null or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Ligação inválida, cancelada ou expirada.';end if;
  if l.used_at is not null then
    select * into r from public.rh_fleet_signature_receipts where link_id=l.id;
    return jsonb_build_object('link_id',l.id,'purpose',l.purpose,'status',case when l.purpose='editor' then 'submitted' else 'signed' end,'signed_at',r.signed_at,'signer_name',r.signer_name);
  end if;
  select * into h from public.rh_fleet_handovers where id=l.handover_id;
  if h.status<>'draft' then raise exception 'Este auto já está fechado.';end if;
  payload:=public.rh_fleet_sign_payload(h.id);
  if l.purpose<>'editor' then
    select * into s from public.rh_fleet_sign_sessions where handover_id=h.id;
    if not s.active or not s.required or s.content_hash is distinct from l.content_hash or public.rh_fleet_doc_hash(h.id)<>l.content_hash then raise exception 'O auto foi alterado. Pede uma nova ligação ao RH.';end if;
  end if;
  -- The recipient receives only this operation, never HR rows or other vehicles.
  return jsonb_build_object('link_id',l.id,'purpose',l.purpose,'status','open','expires_at',l.expires_at,'content_hash',l.content_hash,
    'number',h.number,'handover',jsonb_build_object('id',h.id,'vehicle_id',h.vehicle_id,'status',h.status,'version',h.version,'expected_custody_id',h.expected_custody_id,'data',h.data-'signatures'-'signature_receipts'),
    'payload',payload,'signing_at',s.created_at);
end; $$;

create or replace function public.rh_fleet_remote_save(p_hash text,p_version integer,p_patch jsonb,p_submit boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;patch jsonb;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  select * into h from public.rh_fleet_handovers where id=l.handover_id for update;
  select * into l from public.rh_fleet_share_links where token_hash=p_hash for update;
  if l.id is null or l.purpose<>'editor' or l.revoked_at is not null or l.used_at is not null or l.expires_at<=now() or h.status<>'draft' then raise exception 'A ligação de preenchimento já não está disponível.';end if;
  if exists(select 1 from public.rh_fleet_sign_sessions where handover_id=h.id and required and active) then raise exception 'O auto está bloqueado para assinaturas.';end if;
  if jsonb_typeof(p_patch)<>'object' then raise exception 'Dados inválidos.';end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into patch from jsonb_each(p_patch) where key in ('at','expected_return','odometer','fuel','place','inspection','damage_markers','damage_notes','notes','driver_fields','checked');
  if h.version<>p_version and h.data is distinct from h.data||patch then raise exception 'O auto mudou entretanto. Reabre a ligação para rever os dados.';end if;
  if octet_length(patch::text)>1000000 then raise exception 'Dados demasiado grandes.';end if;
  update public.rh_fleet_handovers set data=data||patch,version=version+1,updated_at=now() where id=h.id returning * into h;
  if p_submit then update public.rh_fleet_share_links set used_at=now() where id=l.id;end if;
  return jsonb_build_object('id',h.id,'vehicle_id',h.vehicle_id,'status',h.status,'version',h.version,'data',h.data-'signatures'-'signature_receipts');
end; $$;

create or replace function public.rh_fleet_remote_sign(p_hash text,p_name text,p_signature text,p_content_hash text,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;r public.rh_fleet_signature_receipts;fingerprint text;receipt jsonb;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  select * into h from public.rh_fleet_handovers where id=l.handover_id for update;
  select * into l from public.rh_fleet_share_links where token_hash=p_hash for update;
  if l.id is null or l.purpose not in ('from','to') or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Ligação de assinatura inválida, cancelada ou expirada.';end if;
  select * into r from public.rh_fleet_signature_receipts where link_id=l.id;
  if l.used_at is not null then
    if r.signer_name=trim(p_name) and r.signature_hash=encode(sha256(convert_to(p_signature,'UTF8')),'hex') then return jsonb_build_object('status','signed','signed_at',r.signed_at,'signer_name',r.signer_name);end if;
    raise exception 'Esta ligação já foi utilizada.';
  end if;
  select * into s from public.rh_fleet_sign_sessions where handover_id=h.id for update;
  fingerprint:=public.rh_fleet_doc_hash(h.id);
  if h.status<>'draft' or not s.active or not s.required or s.content_hash is distinct from l.content_hash or fingerprint is distinct from p_content_hash or fingerprint<>l.content_hash then raise exception 'O auto foi alterado. Pede uma nova ligação ao RH.';end if;
  if p_accept is not true or length(trim(p_name)) not between 2 and 120 or p_name ~ '[[:cntrl:]]' or length(p_signature) not between 100 and 180000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Confirma o teu nome, a assinatura e a aceitação do auto.';end if;
  if exists(select 1 from public.rh_fleet_signature_receipts where handover_id=h.id and purpose=l.purpose and invalidated_at is null and content_hash=fingerprint) then raise exception 'Esta versão já foi assinada neste campo.';end if;
  insert into public.rh_fleet_signature_receipts(handover_id,link_id,purpose,content_hash,signer_name,signature_hash)
    values(h.id,l.id,l.purpose,fingerprint,trim(p_name),encode(sha256(convert_to(p_signature,'UTF8')),'hex')) returning * into r;
  receipt:=jsonb_build_object('id',r.id,'signer_name',r.signer_name,'signed_at',r.signed_at,'content_hash',r.content_hash,'method','screen');
  update public.rh_fleet_handovers set data=jsonb_set(jsonb_set(data,'{signatures}',coalesce(data->'signatures','{}'::jsonb)||jsonb_build_object(l.purpose,p_signature)),'{signature_receipts}',coalesce(data->'signature_receipts','{}'::jsonb)||jsonb_build_object(l.purpose,receipt)),version=version+1,updated_at=now() where id=h.id;
  update public.rh_fleet_share_links set used_at=now() where id=l.id;
  return jsonb_build_object('status','signed','signed_at',r.signed_at,'signer_name',r.signer_name);
end; $$;

create or replace function public.rh_fleet_invalidate_signatures() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='draft' and (old.data-'signatures'-'signature_receipts'-'checked') is distinct from (new.data-'signatures'-'signature_receipts'-'checked') then
    if exists(select 1 from public.rh_fleet_sign_sessions where handover_id=old.id) then
      new.data:=jsonb_set(jsonb_set(new.data,'{signatures}','{}'),'{signature_receipts}','{}');
      update public.rh_fleet_signature_receipts set invalidated_at=coalesce(invalidated_at,now()) where handover_id=old.id;
      update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=old.id and purpose in ('from','to');
      update public.rh_fleet_sign_sessions set active=false where handover_id=old.id;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists rh_fleet_signature_content on public.rh_fleet_handovers;
create trigger rh_fleet_signature_content before update of data on public.rh_fleet_handovers for each row execute function public.rh_fleet_invalidate_signatures();

do $$ begin
  if to_regprocedure('public.rh_fleet_confirm_handover_v1(uuid,integer)') is null then
    alter function public.rh_fleet_confirm_handover(uuid,integer) rename to rh_fleet_confirm_handover_v1;
  end if;
end; $$;
create or replace function public.rh_fleet_confirm_handover(p_id uuid,p_version integer)
returns public.rh_fleet_handovers language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.rh_fleet_handovers;s public.rh_fleet_sign_sessions;v uuid;
begin
  if not public.is_rh_admin() then raise exception 'Apenas o administrador pode confirmar entregas.' using errcode='42501';end if;
  select vehicle_id into v from public.rh_fleet_handovers where id=p_id;
  perform 1 from public.rh_fleet_vehicles where id=v for update;
  select * into h from public.rh_fleet_handovers where id=p_id for update;
  select * into s from public.rh_fleet_sign_sessions where handover_id=p_id for update;
  if h.status<>'confirmed' and s.required then
    if not s.active or public.rh_fleet_doc_hash(p_id)<>s.content_hash or (select count(distinct purpose) from public.rh_fleet_signature_receipts where handover_id=p_id and content_hash=s.content_hash and invalidated_at is null)<>2 then raise exception 'Faltam assinaturas válidas de quem entrega e de quem recebe/devolve.';end if;
    if h.data->'signature_receipts'->'from'->>'content_hash' is distinct from s.content_hash or h.data->'signature_receipts'->'to'->>'content_hash' is distinct from s.content_hash then raise exception 'As assinaturas do auto foram alteradas. Pede novas assinaturas.';end if;
    if exists(select 1 from public.rh_fleet_signature_receipts r where r.handover_id=p_id and r.content_hash=s.content_hash and r.invalidated_at is null and r.signature_hash is distinct from encode(sha256(convert_to(h.data->'signatures'->>r.purpose,'UTF8')),'hex')) then raise exception 'A imagem de uma assinatura foi alterada. Pede novas assinaturas.';end if;
  end if;
  h:=public.rh_fleet_confirm_handover_v1(p_id,p_version);
  update public.rh_fleet_share_links set revoked_at=coalesce(revoked_at,now()) where handover_id=p_id and used_at is null;
  return h;
end; $$;

revoke all on function public.rh_fleet_sign_payload(uuid),public.rh_fleet_doc_hash(uuid),public.rh_fleet_read_share(text),public.rh_fleet_remote_save(text,integer,jsonb,boolean),public.rh_fleet_remote_sign(text,text,text,text,boolean),public.rh_fleet_invalidate_signatures() from public,anon,authenticated;
revoke all on function public.rh_fleet_confirm_handover_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.rh_fleet_create_share(uuid,text,text,timestamptz),public.rh_fleet_prepare_share(uuid),public.rh_fleet_share_status(uuid),public.rh_fleet_revoke_shares(uuid),public.rh_fleet_confirm_handover(uuid,integer) from public,anon;
grant execute on function public.rh_fleet_create_share(uuid,text,text,timestamptz),public.rh_fleet_prepare_share(uuid),public.rh_fleet_share_status(uuid),public.rh_fleet_revoke_shares(uuid),public.rh_fleet_confirm_handover(uuid,integer) to authenticated;
grant execute on function public.rh_fleet_read_share(text),public.rh_fleet_remote_save(text,integer,jsonb,boolean),public.rh_fleet_remote_sign(text,text,text,text,boolean) to service_role;
drop policy if exists rh_fleet_private_upload on storage.objects;
create policy rh_fleet_private_upload on storage.objects for insert to authenticated with check(bucket_id='rh-fleet' and public.is_rh_admin()
  and exists(select 1 from public.rh_fleet_handovers h where h.id::text=split_part(name,'/',1) and (h.status='confirmed' or (h.status='draft' and not exists(select 1 from public.rh_fleet_sign_sessions s where s.handover_id=h.id and s.required and s.active)))));
notify pgrst,'reload schema';
commit;
