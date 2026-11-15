-- Adds isolated Telegram settings and delivery receipts. Employee data is untouched.
begin;

create table if not exists public.rh_telegram_config (
  id integer primary key check (id=1),
  enabled boolean not null default false,
  chat_id text,
  chat_label text,
  configured_by uuid,
  pair_hash text,
  pair_admin uuid,
  pair_expires timestamptz,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.rh_telegram_config(id) values(1) on conflict(id) do nothing;

create table if not exists public.rh_telegram_deliveries (
  event_key text primary key,
  person_id text not null,
  event_date date not null,
  event_kind text not null check(event_kind in ('birthday','work')),
  chat_id text not null,
  status text not null check(status in ('preparing','sending','sent','failed','uncertain')),
  lease uuid not null,
  lease_until timestamptz not null,
  attempts integer not null default 1,
  message_id bigint,
  error_code text,
  updated_at timestamptz not null default now()
);
create index if not exists rh_telegram_deliveries_date_idx on public.rh_telegram_deliveries(event_date);

alter table public.rh_telegram_config enable row level security;
alter table public.rh_telegram_deliveries enable row level security;
revoke all on public.rh_telegram_config,public.rh_telegram_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.rh_telegram_config,public.rh_telegram_deliveries to service_role;

create or replace function public.rh_claim_telegram_delivery(
  p_key text,p_person text,p_date date,p_kind text,p_chat text
) returns uuid language plpgsql set search_path=pg_catalog as $$
declare v_lease uuid;
begin
  if not exists(select 1 from public.rh_telegram_config where id=1 and enabled and chat_id=p_chat) then
    return null;
  end if;
  insert into public.rh_telegram_deliveries as delivery
    (event_key,person_id,event_date,event_kind,chat_id,status,lease,lease_until)
  values(p_key,p_person,p_date,p_kind,p_chat,'preparing',gen_random_uuid(),now()+interval '10 minutes')
  on conflict(event_key) do update set
    status='preparing',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',
    attempts=delivery.attempts+1,error_code=null,updated_at=now()
  where delivery.attempts<3 and (delivery.status='failed' or (delivery.status='preparing' and delivery.lease_until<now()))
  returning lease into v_lease;
  return v_lease;
end;
$$;

create or replace function public.rh_finish_telegram_delivery(
  p_key text,p_lease uuid,p_status text,p_message bigint default null,p_error text default null
) returns boolean language plpgsql set search_path=pg_catalog as $$
declare v_count integer;
begin
  update public.rh_telegram_deliveries set
    status=p_status,message_id=coalesce(p_message,message_id),error_code=left(p_error,80),updated_at=now()
  where event_key=p_key and lease=p_lease and (
    (status='preparing' and p_status='sending' and lease_until>now() and exists(
      select 1 from public.rh_telegram_config c where c.id=1 and c.enabled and c.chat_id=rh_telegram_deliveries.chat_id
    )) or
    (status='preparing' and p_status='failed') or
    (status='sending' and p_status in ('sent','failed','uncertain'))
  );
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;

revoke all on function public.rh_claim_telegram_delivery(text,text,date,text,text) from public,anon,authenticated;
revoke all on function public.rh_finish_telegram_delivery(text,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.rh_claim_telegram_delivery(text,text,date,text,text) to service_role;
grant execute on function public.rh_finish_telegram_delivery(text,uuid,text,bigint,text) to service_role;
commit;
