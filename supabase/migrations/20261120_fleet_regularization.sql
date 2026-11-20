begin;
create schema if not exists rh_release_backups;
revoke all on schema rh_release_backups from public,anon,authenticated;
create table if not exists rh_release_backups.fleet_regularization_20261120(entity text primary key,payload jsonb not null);
alter table rh_release_backups.fleet_regularization_20261120 enable row level security;
revoke all on rh_release_backups.fleet_regularization_20261120 from public,anon,authenticated;
do $$ declare tab text;begin
  foreach tab in array array['rh_fleet_handovers','rh_fleet_vehicles','rh_fleet_custody','rh_fleet_sign_sessions','rh_fleet_signature_receipts','rh_fleet_share_links'] loop
    execute format('insert into rh_release_backups.fleet_regularization_20261120 values (%L,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t)) on conflict do nothing',tab,tab);
  end loop;
  foreach tab in array array['rh_fleet_confirm_handover_v1(uuid,integer)','rh_fleet_delete_handover(uuid,integer,text,boolean)'] loop
    insert into rh_release_backups.fleet_regularization_20261120 values(tab,to_jsonb(pg_get_functiondef(('public.'||tab)::regprocedure))) on conflict do nothing;
  end loop;
end; $$;

-- Guard exact source changes: abort on an unexpected installed function version.
do $$ declare definition text;patch record;begin
  definition:=pg_get_functiondef('public.rh_fleet_confirm_handover_v1(uuid,integer)'::regprocedure);
  if position('regularization-v1' in definition)>0 then return;end if;
  for patch in select * from (values
    ($old$if d->>'kind'='initial' and c.id is not null then raise exception 'A viatura já tem um responsável. Regista uma passagem.'; end if;$old$,
     $new$-- regularization-v1: inspection of the existing assignment is not a custody transfer.
  if d->>'purpose'='regularization' and (d->>'kind'<>'initial' or c.id is null or d->>'to_person_id' is distinct from c.person_id) then raise exception 'A regularização tem de manter o responsável atual.';end if;
  if d->>'kind'='initial' and c.id is not null and coalesce(d->>'purpose','')<>'regularization' then raise exception 'A viatura já tem um responsável. Para manter a mesma pessoa, escolhe Regularizar atribuição atual.';end if;$new$),
    ($old$p.id is null or p.id=c.person_id or$old$,$new$p.id is null or (p.id=c.person_id and coalesce(d->>'purpose','')<>'regularization') or$new$),
    ($old$if c.id is not null then update public.rh_fleet_custody set to_at=at_time where id=c.id; end if;$old$,$new$if c.id is not null and coalesce(d->>'purpose','')<>'regularization' then update public.rh_fleet_custody set to_at=at_time where id=c.id;end if;$new$),
    ($old$if d->>'kind'<>'return' then insert into public.rh_fleet_custody$old$,$new$if d->>'kind'<>'return' and coalesce(d->>'purpose','')<>'regularization' then insert into public.rh_fleet_custody$new$),
    ($old$case when d->>'kind' in ('initial','permanent') then p.id else habitual_person_id end$old$,$new$case when d->>'kind' in ('initial','permanent') and coalesce(d->>'purpose','')<>'regularization' then p.id else habitual_person_id end$new$)
  ) as changes(before,after) loop
    if (length(definition)-length(replace(definition,patch.before,'')))/length(patch.before)<>1 then raise exception 'Versão inesperada da confirmação de autos; instalação cancelada.';end if;
    definition:=replace(definition,patch.before,patch.after);
  end loop;
  execute definition;
end; $$;

do $$ declare definition text;patch record;begin
  definition:=pg_get_functiondef('public.rh_fleet_delete_handover(uuid,integer,text,boolean)'::regprocedure);
  if position('regularization-delete-v1' in definition)>0 then return;end if;
  for patch in select * from (values
    ($old$external:=coalesce(h.data->>'destination'='external_structure',false);at_time:=$old$,$new$-- regularization-delete-v1: only the document and its own odometer revision are undone.
    external:=coalesce(h.data->>'destination'='external_structure',false);at_time:=$new$),
    ($old$h.data->>'kind'<>'return' and (c.id is null$old$,$new$h.data->>'kind'<>'return' and coalesce(h.data->>'purpose','')<>'regularization' and (c.id is null$new$),
    ($old$h.data->>'kind' in ('initial','permanent') and v.habitual_person_id$old$,$new$h.data->>'kind' in ('initial','permanent') and coalesce(h.data->>'purpose','')<>'regularization' and v.habitual_person_id$new$),
    ($old$previous.to_at is distinct from at_time$old$,$new$(case when h.data->>'purpose'='regularization' then previous.to_at is not null or previous.person_id is distinct from h.data->>'to_person_id' else previous.to_at is distinct from at_time end)$new$)
  ) as changes(before,after) loop
    if (length(definition)-length(replace(definition,patch.before,'')))/length(patch.before)<>1 then raise exception 'Versão inesperada da eliminação de autos; instalação cancelada.';end if;
    definition:=replace(definition,patch.before,patch.after);
  end loop;
  execute definition;
end; $$;
notify pgrst,'reload schema';
commit;
