begin;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated;
create table if not exists rh_release_backups.fleet_signatures_20261120(entity text primary key,payload jsonb not null);
alter table rh_release_backups.fleet_signatures_20261120 enable row level security;
revoke all on rh_release_backups.fleet_signatures_20261120 from public,anon,authenticated;
do $$ declare tab text;begin
  foreach tab in array array['rh_fleet_handovers','rh_fleet_vehicles','rh_fleet_custody','rh_fleet_sign_sessions','rh_fleet_signature_receipts','rh_fleet_share_links'] loop
    execute format('insert into rh_release_backups.fleet_signatures_20261120 values (%L,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t)) on conflict do nothing',tab,tab);
  end loop;
  foreach tab in array array['rh_fleet_read_share(text)','rh_fleet_share_status(uuid)'] loop
    insert into rh_release_backups.fleet_signatures_20261120 values(tab,to_jsonb(pg_get_functiondef(('public.'||tab)::regprocedure))) on conflict do nothing;
  end loop;
end; $$;

create table if not exists public.rh_fleet_signature_archive(
  receipt_id uuid primary key, handover_id uuid not null references public.rh_fleet_handovers(id) on delete cascade,
  purpose text not null check(purpose in ('from','to')),signer_name text not null,signed_at timestamptz not null,
  content_hash text not null,signature_hash text not null,signature text not null,payload jsonb not null,archived_at timestamptz not null default now()
);
alter table public.rh_fleet_signature_archive enable row level security;
revoke all on public.rh_fleet_signature_archive from public,anon,authenticated;
grant select on public.rh_fleet_signature_archive to authenticated;
drop policy if exists fleet_admin_read on public.rh_fleet_signature_archive;
create policy fleet_admin_read on public.rh_fleet_signature_archive for select to authenticated using(public.is_rh_admin());
alter table public.rh_fleet_signature_receipts add column if not exists reconfirmed_from uuid;

create or replace function public.rh_fleet_archive_signatures(h public.rh_fleet_handovers) returns void
language sql security definer set search_path=public,pg_temp as $$
  insert into public.rh_fleet_signature_archive(receipt_id,handover_id,purpose,signer_name,signed_at,content_hash,signature_hash,signature,payload)
  select r.id,h.id,r.purpose,r.signer_name,r.signed_at,r.content_hash,r.signature_hash,h.data->'signatures'->>r.purpose,s.payload
  from public.rh_fleet_signature_receipts r join public.rh_fleet_sign_sessions s on s.handover_id=r.handover_id and s.content_hash=r.content_hash
  where r.handover_id=h.id and h.data->'signature_receipts'->r.purpose->>'id'=r.id::text
    and length(h.data->'signatures'->>r.purpose) between 100 and 180000
    and h.data->'signatures'->>r.purpose ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
    and r.signature_hash=encode(sha256(convert_to(h.data->'signatures'->>r.purpose,'UTF8')),'hex')
  on conflict(receipt_id) do nothing;
$$;
create or replace function public.rh_fleet_archive_signature_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.rh_fleet_archive_signatures(new);return new;end; $$;
drop trigger if exists rh_fleet_archive_signature on public.rh_fleet_handovers;
create trigger rh_fleet_archive_signature after insert or update of data on public.rh_fleet_handovers for each row execute function public.rh_fleet_archive_signature_trigger();
do $$ declare h public.rh_fleet_handovers;begin for h in select * from public.rh_fleet_handovers loop perform public.rh_fleet_archive_signatures(h);end loop;end; $$;

create or replace function public.rh_fleet_signature_name(value text) returns text
language sql immutable set search_path=public,pg_temp as $$ select lower(regexp_replace(trim(coalesce(value,'')),'\s+',' ','g')); $$;
create or replace function public.rh_fleet_signature_party(payload jsonb,role text) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',payload->(case when role='from' then 'from_person' else 'to_person' end)->>'id',
    'name',public.rh_fleet_signature_name(coalesce(nullif(trim(payload->'operation'->'driver_fields'->role->>'name'),''),payload->(case when role='from' then 'from_person' else 'to_person' end)->>'name')));
$$;
do $$ begin
  if to_regprocedure('public.rh_fleet_read_share_v1(text)') is null then alter function public.rh_fleet_read_share(text) rename to rh_fleet_read_share_v1;end if;
end; $$;
create or replace function public.rh_fleet_reconfirm_candidate(p_hash text) returns public.rh_fleet_signature_archive
language plpgsql security definer set search_path=public,pg_temp as $$
declare value jsonb;party jsonb;a public.rh_fleet_signature_archive;
begin
  value:=public.rh_fleet_read_share_v1(p_hash);
  if value->>'status'<>'open' or value->>'purpose' not in ('from','to') then return a;end if;
  party:=public.rh_fleet_signature_party(value->'payload',value->>'purpose');
  select * into a from public.rh_fleet_signature_archive s where s.handover_id=(value->'handover'->>'id')::uuid and s.purpose=value->>'purpose'
    and public.rh_fleet_signature_party(s.payload,s.purpose)=party
    and (party->>'id' is not null or (party->>'name'<>'' and party->>'name'=public.rh_fleet_signature_name(s.signer_name)))
  order by s.signed_at desc,s.receipt_id limit 1;
  return a;
end; $$;
create or replace function public.rh_fleet_read_share(p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare value jsonb;a public.rh_fleet_signature_archive;
begin
  value:=public.rh_fleet_read_share_v1(p_hash);
  if value->>'status'='open' and value->>'purpose' in ('from','to') then
    a:=public.rh_fleet_reconfirm_candidate(p_hash);
    if a.receipt_id is not null then value:=value||jsonb_build_object('previous_signature',jsonb_build_object('id',a.receipt_id,'signer_name',a.signer_name,'signed_at',a.signed_at));end if;
  end if;
  return value;
end; $$;
create or replace function public.rh_fleet_remote_reconfirm(p_hash text,p_previous uuid,p_name text,p_content_hash text,p_accept boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.rh_fleet_share_links;a public.rh_fleet_signature_archive;r public.rh_fleet_signature_receipts;result jsonb;
begin
  select * into l from public.rh_fleet_share_links where token_hash=p_hash;
  if l.id is null or l.purpose not in ('from','to') or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Ligação inválida, cancelada ou expirada.';end if;
  if p_accept is not true then raise exception 'Confirma que leste e aceitas a nova versão do auto.';end if;
  perform 1 from public.rh_fleet_handovers where id=l.handover_id for update;
  if l.used_at is not null then
    select * into r from public.rh_fleet_signature_receipts where link_id=l.id;
    if r.reconfirmed_from=p_previous and r.content_hash=p_content_hash and public.rh_fleet_signature_name(r.signer_name)=public.rh_fleet_signature_name(p_name) then
      return jsonb_build_object('status','signed','signed_at',r.signed_at,'signer_name',r.signer_name);
    end if;
    raise exception 'Esta ligação já foi utilizada.';
  end if;
  a:=public.rh_fleet_reconfirm_candidate(p_hash);
  if a.receipt_id is null or a.receipt_id is distinct from p_previous or public.rh_fleet_signature_name(a.signer_name) is distinct from public.rh_fleet_signature_name(p_name) then raise exception 'A assinatura guardada não corresponde a esta pessoa e a este campo do auto.';end if;
  result:=public.rh_fleet_remote_sign(p_hash,a.signer_name,a.signature,p_content_hash,true);
  update public.rh_fleet_signature_receipts set reconfirmed_from=a.receipt_id where link_id=l.id;
  update public.rh_fleet_handovers set data=jsonb_set(data,array['signature_receipts',l.purpose],(data->'signature_receipts'->l.purpose)||jsonb_build_object('method','screen_reconfirmed','previous_receipt_id',a.receipt_id)) where id=l.handover_id;
  return result;
end; $$;

-- Include metadata only; historical signature images remain private on the server.
do $$ declare definition text;needle text:=$n$'receipts',coalesce$n$;begin
  definition:=pg_get_functiondef('public.rh_fleet_share_status(uuid)'::regprocedure);
  if position('signature_history' in definition)>0 then return;end if;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Versão inesperada do estado das assinaturas.';end if;
  definition:=replace(definition,needle,$n$'signature_history',coalesce((select jsonb_agg(jsonb_build_object('id',receipt_id,'purpose',purpose,'signer_name',signer_name,'signed_at',signed_at,'content_hash',content_hash) order by signed_at desc) from public.rh_fleet_signature_archive where handover_id=p_id),'[]'::jsonb),'receipts',coalesce$n$);
  execute definition;
end; $$;
create or replace function public.rh_fleet_backup_signature_history() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.rh_fleet_deletion_backups set data=data||jsonb_build_object('signature_history',coalesce((select jsonb_agg(to_jsonb(a)) from public.rh_fleet_signature_archive a where handover_id=old.id),'[]'::jsonb)) where id=old.id;
  return old;
end; $$;
drop trigger if exists rh_fleet_backup_signature_history on public.rh_fleet_handovers;
create trigger rh_fleet_backup_signature_history before delete on public.rh_fleet_handovers for each row execute function public.rh_fleet_backup_signature_history();
revoke all on function public.rh_fleet_archive_signatures(public.rh_fleet_handovers),public.rh_fleet_archive_signature_trigger(),public.rh_fleet_signature_name(text),public.rh_fleet_signature_party(jsonb,text),public.rh_fleet_read_share_v1(text),public.rh_fleet_reconfirm_candidate(text),public.rh_fleet_backup_signature_history() from public,anon,authenticated,service_role;
revoke all on function public.rh_fleet_read_share(text),public.rh_fleet_remote_reconfirm(text,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.rh_fleet_read_share(text),public.rh_fleet_remote_reconfirm(text,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
