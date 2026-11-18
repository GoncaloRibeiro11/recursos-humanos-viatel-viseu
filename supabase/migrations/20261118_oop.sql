-- Additive OOP module. Install in an isolated test database first, never during a preview build.
begin;
do $$ begin
  if to_regclass('public.rh_assignment_history') is null then raise exception 'Instala primeiro o histórico de equipas.';end if;
end $$;
create table if not exists public.rh_oop_contacts(
  id uuid primary key,person_id text references public.rh_persons(id) on delete set null,
  person_ref text not null,person_name text not null,ce_ref text not null,ce_name text not null,
  occurred_at timestamptz not null,effective boolean not null,product text,outcome text not null,
  end_stage integer check(end_stage between 1 and 7),reason text,data jsonb not null,
  created_by uuid references auth.users(id) on delete set null,version integer not null default 1,
  voided_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists oop_contacts_date on public.rh_oop_contacts(occurred_at desc,id);
create index if not exists oop_contacts_person_date on public.rh_oop_contacts(person_ref,occurred_at desc);
create index if not exists oop_contacts_team_date on public.rh_oop_contacts(ce_ref,occurred_at desc);
create table if not exists public.rh_oop_actions(
  id uuid primary key,person_id text references public.rh_persons(id) on delete set null,
  person_ref text not null,person_name text not null,ce_ref text not null,ce_name text not null,
  contact_id uuid references public.rh_oop_contacts(id),kind text not null check(kind in ('followup','training')),
  stage integer check(stage between 1 and 7),description text not null,due_at timestamptz not null,
  status text not null check(status in ('open','in_progress','done','cancelled')),progress text not null default '',
  owner_ce_ref text,created_by uuid references auth.users(id) on delete set null,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists oop_one_contact_followup on public.rh_oop_actions(contact_id) where kind='followup' and contact_id is not null;
create index if not exists oop_actions_person_due on public.rh_oop_actions(person_ref,due_at);
create table if not exists public.rh_oop_revisions(
  id uuid primary key default gen_random_uuid(),entity text not null,target_id uuid not null,
  person_ref text not null,ce_ref text not null,actor_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,reason text not null default '',before_data jsonb,after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists oop_revisions_target on public.rh_oop_revisions(target_id,created_at desc);
create table if not exists public.rh_oop_requests(
  id uuid primary key,actor_id uuid,operation text not null,target_id uuid not null,
  fingerprint text not null,response jsonb,created_at timestamptz not null default now()
);
alter table public.rh_oop_contacts enable row level security;
alter table public.rh_oop_actions enable row level security;
alter table public.rh_oop_revisions enable row level security;
alter table public.rh_oop_requests enable row level security;
revoke all on public.rh_oop_contacts,public.rh_oop_actions,public.rh_oop_revisions,public.rh_oop_requests from public,anon,authenticated;
grant select on public.rh_oop_contacts,public.rh_oop_actions,public.rh_oop_revisions to authenticated;

create or replace function rh_private.oop_manager() returns text
language sql stable security definer set search_path='' as $$
  select u.person_id from public.user_profiles u join public.rh_persons p on p.id=u.person_id
  where u.user_id=auth.uid() and u.role='gestor' and p.ativo;
$$;
create or replace function rh_private.oop_current_member(p_person text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rh_persons where id=p_person and chefe_id=rh_private.oop_manager());
$$;
create or replace function rh_private.oop_can_read(p_person text,p_ce text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_rh_admin() or (rh_private.oop_manager() is not null and (p_ce=rh_private.oop_manager() or rh_private.oop_current_member(p_person)));
$$;
create or replace function rh_private.oop_require_user() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not(public.is_rh_admin() or rh_private.oop_manager() is not null) then raise exception 'Acesso OOP não autorizado.' using errcode='42501';end if;
end; $$;
create or replace function rh_private.oop_request(p_request uuid,p_operation text,p_target uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rh_oop_requests;fingerprint text;
begin
  perform rh_private.oop_require_user();
  if p_payload->>'actor' is distinct from auth.uid()::text then raise exception 'A conta mudou. A alteração pendente pertence a outra sessão.' using errcode='42501';end if;
  if p_request is null or p_target is null then raise exception 'Identificador do pedido em falta.';end if;
  fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into r from public.rh_oop_requests where id=p_request;
  if r.id is not null then
    if r.actor_id is distinct from auth.uid() or r.operation<>p_operation or r.target_id<>p_target or r.fingerprint<>fingerprint then raise exception 'Pedido repetido com dados diferentes.';end if;
    return r.response;
  end if;
  insert into public.rh_oop_requests(id,actor_id,operation,target_id,fingerprint) values(p_request,auth.uid(),p_operation,p_target,fingerprint);
  return null;
end; $$;
create or replace function rh_private.oop_generic(p_text text) returns boolean
language sql immutable set search_path='' as $$ select trim(lower(coalesce(p_text,''))) ~ '^(o )?(cliente )?(não quis|nao quis|está caro|esta caro|vai pensar)[.! ]*$'; $$;
drop policy if exists oop_contacts_read on public.rh_oop_contacts;
create policy oop_contacts_read on public.rh_oop_contacts for select to authenticated using(rh_private.oop_can_read(person_ref,ce_ref));
drop policy if exists oop_actions_read on public.rh_oop_actions;
create policy oop_actions_read on public.rh_oop_actions for select to authenticated using(rh_private.oop_can_read(person_ref,ce_ref));
drop policy if exists oop_revisions_read on public.rh_oop_revisions;
create policy oop_revisions_read on public.rh_oop_revisions for select to authenticated using(rh_private.oop_can_read(person_ref,ce_ref));

create or replace function public.rh_oop_save_contact(p_id uuid,p_version integer,p_data jsonb,p_request_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<save_contact>>
declare old public.rh_oop_contacts;c public.rh_oop_contacts;p public.rh_persons;assignment public.rh_assignment_history;
  manager_name text;stamp timestamptz;day date;effective boolean;product text;outcome text;reason text;ending integer;
  stages jsonb:='[]';s jsonb;i integer;status text;note text;clean jsonb;answer jsonb;task public.rh_oop_actions;k text;
begin
  answer:=rh_private.oop_request(p_request_id,'contact',p_id,jsonb_build_object('actor',p_actor_id,'version',p_version,'data',p_data));if answer is not null then return answer;end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 or p_version is null or p_version<0 then raise exception 'Contacto inválido ou demasiado longo.';end if;
  foreach k in array array['fact','objection','response','followup_action','revision_reason'] loop
    if p_data?k and jsonb_typeof(p_data->k) is distinct from 'string' then raise exception 'Texto inválido: %.',k;end if;
  end loop;
  select * into p from public.rh_persons where id=p_data->>'person_ref' for update;
  if p.id is null then raise exception 'Seleciona um vendedor existente no RH.';end if;
  stamp:=nullif(p_data->>'occurred_at','')::timestamptz;day:=(stamp at time zone 'Europe/Lisbon')::date;
  if stamp is null or stamp>now()+interval '2 minutes' or (p.entrada is not null and day<p.entrada) or (p.saida is not null and day>p.saida) or (not p.ativo and p.saida is null) then raise exception 'Data de contacto incompatível com a atividade do vendedor.';end if;
  select * into assignment from public.rh_assignment_history where person_id=p.id and valid_from<=day and (valid_to is null or day<valid_to) order by valid_from desc limit 1;
  if assignment.id is null or assignment.role_code is distinct from 'vendedor' or nullif(assignment.chefe_id,'') is null then raise exception 'Não existe vendedor e equipa elegíveis nesta data.';end if;
  if not public.is_rh_admin() and (not rh_private.oop_current_member(p.id) or assignment.chefe_id is distinct from rh_private.oop_manager()) then raise exception 'Só podes registar contactos da tua equipa na data do acompanhamento.' using errcode='42501';end if;
  select * into old from public.rh_oop_contacts where id=p_id for update;
  if old.id is not null and (old.version<>p_version or old.voided_at is not null) then raise exception 'O contacto mudou entretanto ou foi anulado. Reabre o registo antes de guardar.';end if;
  if old.id is null and p_version<>0 then raise exception 'Contacto inexistente.';end if;
  if old.id is not null and (old.person_ref<>p.id or old.occurred_at<>stamp) then raise exception 'A identidade e a data do contacto são históricas. Anula o registo incorreto e cria o correto.';end if;
  if old.id is not null and not public.is_rh_admin() and old.created_by is distinct from auth.uid() then raise exception 'Os contactos de outro observador são apenas de consulta.' using errcode='42501';end if;
  if old.id is not null and nullif(trim(p_data->>'revision_reason'),'') is null then raise exception 'Indica o motivo da correção.';end if;
  if jsonb_typeof(p_data->'effective') is distinct from 'boolean' then raise exception 'Indica se houve conversa.';end if;
  effective:=(p_data->>'effective')::boolean;product:=p_data->>'product';outcome:=p_data->>'outcome';reason:=nullif(p_data->>'reason','');ending:=nullif(p_data->>'end_stage','')::integer;
  if effective then
    if product is null or product not in ('tv','energy','both','unidentified') or outcome is null or outcome not in ('tv','energy','both','refusal','followup') then raise exception 'Seleciona oportunidade e resultado.';end if;
    if ending is not null and ending not between 1 and 7 then raise exception 'Etapa de término inválida.';end if;
    if jsonb_typeof(p_data->'stages') is distinct from 'array' or jsonb_array_length(p_data->'stages')<>7 then raise exception 'Avalia as sete etapas.';end if;
    for i in 1..7 loop
      s:=p_data->'stages'->(i-1);status:=s->>'status';note:=trim(coalesce(s->>'note',''));
      if s->>'stage' is distinct from i::text or length(note)>500 or (s?'note' and jsonb_typeof(s->'note') is distinct from 'string') then raise exception 'Etapa inválida.';end if;
      if ending is not null and i>ending then
        if status is distinct from 'not_reached' then raise exception 'Etapas posteriores ao término não foram alcançadas.';end if;
        note:='';
      elsif status is null or status not in ('good','difficulty','omitted','unobserved','no_objections') or (status='no_objections' and i<>6) then raise exception 'Avaliação de etapa em falta ou inválida.';
      end if;
      if status in ('difficulty','omitted') and (note='' or rh_private.oop_generic(note)) then raise exception 'Descreve o comportamento concreto na etapa %.',i;end if;
      stages:=stages||jsonb_build_array(jsonb_build_object('stage',i,'status',status,'note',note));
    end loop;
    if outcome='refusal' and (reason is null or reason not in ('price_value','commitment','satisfied','no_change','decision_absent','coverage','need_unknown','interrupted','no_reason','other')) then raise exception 'Indica o motivo ou Sem motivo declarado.';end if;
    if reason is not null and reason not in ('price_value','commitment','satisfied','no_change','decision_absent','coverage','need_unknown','interrupted','no_reason','other') then raise exception 'Motivo inválido.';end if;
    if ((outcome='refusal' and reason<>'no_reason') or reason='other') and nullif(trim(p_data->>'fact'),'') is null then raise exception 'Regista o facto concreto observado.';end if;
    if outcome in ('tv','energy','both') and (ending is not null or stages->6->>'status' in ('not_reached','omitted')) then raise exception 'Numa venda concluída, confirma a execução do fecho.';end if;
    if (outcome='tv' and product not in ('tv','both')) or (outcome='energy' and product not in ('energy','both')) or (outcome='both' and product<>'both') then raise exception 'O resultado não corresponde à oportunidade trabalhada.';end if;
    if nullif(trim(p_data->>'objection'),'') is not null and nullif(trim(p_data->>'response'),'') is null then raise exception 'Regista a resposta ou indica que o vendedor não respondeu.';end if;
    if stages->5->>'status'='difficulty' and (nullif(trim(p_data->>'objection'),'') is null or nullif(trim(p_data->>'response'),'') is null) then raise exception 'Regista a objeção e a resposta concreta.';end if;
    if stages->5->>'status'='no_objections' and nullif(trim(p_data->>'objection'),'') is not null then raise exception 'Foi registada uma objeção. Revê a opção Não existiram objeções.';end if;
    if not(coalesce(p_data->'diagnosis'->>'service','') in ('known','unknown','not_applicable') and coalesce(p_data->'diagnosis'->>'need','') in ('known','unknown','not_applicable') and coalesce(p_data->'diagnosis'->>'decision','') in ('known','unknown','not_applicable')) then raise exception 'Confirma os campos do diagnóstico.';end if;
    foreach k in array array['service','need','decision'] loop
      if p_data->'diagnosis'->>k='known' and (jsonb_typeof(p_data->'diagnosis'->(k||'_note')) is distinct from 'string' or nullif(trim(p_data->'diagnosis'->>(k||'_note')),'') is null or length(p_data->'diagnosis'->>(k||'_note'))>400) then raise exception 'Regista o detalhe do diagnóstico apurado.';end if;
    end loop;
    if outcome='followup' and (nullif(trim(p_data->>'followup_action'),'') is null or nullif(p_data->>'followup_at','') is null or (p_data->>'followup_at')::timestamptz<=stamp) then raise exception 'Indica ação e data acordadas para o acompanhamento.';end if;
  else
    if coalesce(reason,'') not in ('no_answer','no_start','interrupted','other','no_reason') then raise exception 'Indica por que não houve conversa.';end if;
    if reason='other' and nullif(trim(p_data->>'fact'),'') is null then raise exception 'Regista o facto concreto observado.';end if;
    product:=null;outcome:='no_conversation';ending:=null;
  end if;
  if rh_private.oop_generic(p_data->>'fact') or rh_private.oop_generic(p_data->>'objection') then raise exception 'Uma frase genérica, por si só, não descreve o que aconteceu. Acrescenta contexto observado.';end if;
  if length(coalesce(p_data->>'fact',''))>1500 or length(coalesce(p_data->>'objection',''))>1500 or length(coalesce(p_data->>'response',''))>1500 or length(coalesce(p_data->>'followup_action',''))>500 or length(coalesce(p_data->>'revision_reason',''))>500 then raise exception 'Texto demasiado longo.';end if;
  clean:=jsonb_build_object('stages',stages,'fact',trim(coalesce(p_data->>'fact','')),'objection',case when effective then trim(coalesce(p_data->>'objection','')) else '' end,'response',case when effective then trim(coalesce(p_data->>'response','')) else '' end,
    'diagnosis',case when effective then jsonb_build_object('service',p_data->'diagnosis'->>'service','need',p_data->'diagnosis'->>'need','decision',p_data->'diagnosis'->>'decision',
      'service_note',case when p_data->'diagnosis'->>'service'='known' then trim(p_data->'diagnosis'->>'service_note') else '' end,
      'need_note',case when p_data->'diagnosis'->>'need'='known' then trim(p_data->'diagnosis'->>'need_note') else '' end,
      'decision_note',case when p_data->'diagnosis'->>'decision'='known' then trim(p_data->'diagnosis'->>'decision_note') else '' end) else '{}'::jsonb end,
    'followup_at',case when outcome='followup' then p_data->>'followup_at' else '' end,'followup_action',case when outcome='followup' then trim(p_data->>'followup_action') else '' end);
  manager_name:=coalesce(assignment.chefe_name,(select name from public.rh_persons where id=assignment.chefe_id),'Equipa');
  select * into task from public.rh_oop_actions where contact_id=p_id and kind='followup' for update;
  if old.id is not null and old.outcome='followup' and outcome='followup' and
    (clean->>'followup_action' is distinct from old.data->>'followup_action' or (clean->>'followup_at')::timestamptz is distinct from (old.data->>'followup_at')::timestamptz) then
    raise exception 'O compromisso inicial é histórico. Atualiza a ação no separador Acompanhamentos.';
  end if;
  if outcome='followup' and old.outcome is distinct from 'followup' and task.id is not null then
    raise exception 'Já existe um acompanhamento deste contacto. Revê a ação existente antes de alterar o desfecho.';
  end if;
  if old.id is null then
    insert into public.rh_oop_contacts(id,person_id,person_ref,person_name,ce_ref,ce_name,occurred_at,effective,product,outcome,end_stage,reason,data,created_by)
    values(p_id,p.id,p.id,p.name,assignment.chefe_id,manager_name,stamp,effective,product,outcome,ending,reason,clean,auth.uid()) returning * into c;
  else
    update public.rh_oop_contacts set effective=save_contact.effective,product=save_contact.product,outcome=save_contact.outcome,end_stage=ending,reason=save_contact.reason,data=clean,version=version+1,updated_at=now() where id=p_id returning * into c;
  end if;
  if outcome='followup' and task.id is null then
    insert into public.rh_oop_actions(id,person_id,person_ref,person_name,ce_ref,ce_name,contact_id,kind,description,due_at,status,owner_ce_ref,created_by)
      values(gen_random_uuid(),p.id,p.id,p.name,c.ce_ref,c.ce_name,c.id,'followup',clean->>'followup_action',(clean->>'followup_at')::timestamptz,'open',p.chefe_id,auth.uid()) returning * into task;
    insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,after_data) values('action',task.id,p.id,c.ce_ref,auth.uid(),p_request_id,to_jsonb(task));
  elsif outcome<>'followup' and task.status in ('open','in_progress') then
    update public.rh_oop_actions set status='cancelled',progress='Desfecho do contacto corrigido.',version=version+1,updated_at=now() where id=task.id;
    insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,reason,before_data,after_data)
      select 'action',id,person_ref,ce_ref,auth.uid(),p_request_id,'Correção do contacto',to_jsonb(task),to_jsonb(a) from public.rh_oop_actions a where id=task.id;
  end if;
  insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,reason,before_data,after_data)
    values('contact',c.id,c.person_ref,c.ce_ref,auth.uid(),p_request_id,coalesce(p_data->>'revision_reason',''),case when old.id is null then null else to_jsonb(old) end,to_jsonb(c));
  answer:=jsonb_build_object('id',c.id,'version',c.version);update public.rh_oop_requests set response=answer where id=p_request_id;return answer;
end; $$;

create or replace function public.rh_oop_save_action(p_id uuid,p_version integer,p_data jsonb,p_request_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<save_action>>
declare old public.rh_oop_actions;a public.rh_oop_actions;p public.rh_persons;c public.rh_oop_contacts;answer jsonb;manager_name text;status text;due timestamptz;kind text;phase integer;
begin
  answer:=rh_private.oop_request(p_request_id,'action',p_id,jsonb_build_object('actor',p_actor_id,'version',p_version,'data',p_data));if answer is not null then return answer;end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>7000 then raise exception 'Ação inválida.';end if;
  select * into p from public.rh_persons where id=p_data->>'person_ref' for update;
  if p.id is null or (not public.is_rh_admin() and not rh_private.oop_current_member(p.id)) then raise exception 'Só podes acompanhar vendedores da tua equipa atual.' using errcode='42501';end if;
  select * into old from public.rh_oop_actions where id=p_id for update;
  if old.id is null and p_version<>0 or old.id is not null and (old.version<>p_version or old.person_ref<>p.id) then raise exception 'A ação mudou entretanto. Reabre antes de guardar.';end if;
  if p_version is null or p_version<0 then raise exception 'Versão inválida.';end if;
  if old.id is null and p.role_code is distinct from 'vendedor' then raise exception 'Seleciona um gestor comercial para o plano.';end if;
  kind:=p_data->>'kind';status:=p_data->>'status';phase:=nullif(p_data->>'stage','')::integer;due:=nullif(p_data->>'due_at','')::timestamptz;
  if not p.ativo and (old.id is null or status not in ('done','cancelled')) then raise exception 'O vendedor está inativo. Apenas podes concluir ou cancelar ações existentes.';end if;
  if coalesce(kind,'') not in ('followup','training') or coalesce(status,'') not in ('open','in_progress','done','cancelled') or due is null or nullif(trim(p_data->>'description'),'') is null or length(p_data->>'description')>1500 or length(coalesce(p_data->>'progress',''))>1500 then raise exception 'Confirma o tipo, a ação, a data e o estado.';end if;
  if kind='training' and (phase is null or phase not between 1 and 7) then raise exception 'Seleciona a competência a trabalhar.';end if;
  if phase is not null and phase not between 1 and 7 then raise exception 'Competência inválida.';end if;
  if status in ('done','cancelled') and nullif(trim(p_data->>'progress'),'') is null then raise exception 'Regista o desfecho observado da ação.';end if;
  if nullif(p_data->>'contact_id','') is not null then
    select * into c from public.rh_oop_contacts where id=(p_data->>'contact_id')::uuid;
    if c.id is null or c.person_ref<>p.id or not rh_private.oop_can_read(c.person_ref,c.ce_ref) or (c.voided_at is not null and old.id is null) then raise exception 'Contacto de evidência indisponível.';end if;
  end if;
  if old.id is not null and (old.kind<>kind or old.contact_id is distinct from c.id) then raise exception 'Preserva o tipo e a evidência da ação original.';end if;
  manager_name:=(select name from public.rh_persons where id=p.chefe_id);
  if old.id is null then
    insert into public.rh_oop_actions(id,person_id,person_ref,person_name,ce_ref,ce_name,contact_id,kind,stage,description,due_at,status,progress,owner_ce_ref,created_by)
      values(p_id,p.id,p.id,p.name,coalesce(p.chefe_id,''),coalesce(manager_name,'Sem equipa'),c.id,kind,phase,trim(p_data->>'description'),due,status,trim(coalesce(p_data->>'progress','')),p.chefe_id,auth.uid()) returning * into a;
  else
    update public.rh_oop_actions set stage=phase,description=trim(p_data->>'description'),due_at=due,status=save_action.status,progress=trim(coalesce(p_data->>'progress','')),owner_ce_ref=p.chefe_id,version=version+1,updated_at=now() where id=p_id returning * into a;
  end if;
  insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,before_data,after_data) values('action',a.id,a.person_ref,a.ce_ref,auth.uid(),p_request_id,case when old.id is null then null else to_jsonb(old) end,to_jsonb(a));
  answer:=jsonb_build_object('id',a.id,'version',a.version);update public.rh_oop_requests set response=answer where id=p_request_id;return answer;
end; $$;

create or replace function public.rh_oop_void_contact(p_id uuid,p_version integer,p_reason text,p_request_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.rh_oop_contacts;answer jsonb;
begin
  answer:=rh_private.oop_request(p_request_id,'void',p_id,jsonb_build_object('actor',p_actor_id,'version',p_version,'reason',p_reason));if answer is not null then return answer;end if;
  select * into c from public.rh_oop_contacts where id=p_id for update;
  if c.id is null or not(public.is_rh_admin() or (rh_private.oop_current_member(c.person_ref) and c.created_by=auth.uid())) then raise exception 'Anulação não autorizada.' using errcode='42501';end if;
  if c.version is distinct from p_version or c.voided_at is not null then raise exception 'O contacto mudou entretanto ou já foi anulado.';end if;
  if nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'Indica o motivo da anulação.';end if;
  update public.rh_oop_contacts set voided_at=now(),version=version+1,updated_at=now() where id=p_id;
  insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,reason,before_data,after_data)
    select 'contact',id,person_ref,ce_ref,auth.uid(),p_request_id,p_reason,to_jsonb(c),to_jsonb(x) from public.rh_oop_contacts x where id=p_id;
  with closed as (update public.rh_oop_actions set status='cancelled',progress='Contacto de origem anulado.',version=version+1,updated_at=now() where contact_id=p_id and kind='followup' and status in ('open','in_progress') returning *)
    insert into public.rh_oop_revisions(entity,target_id,person_ref,ce_ref,actor_id,request_id,reason,after_data) select 'action',id,person_ref,ce_ref,auth.uid(),p_request_id,p_reason,to_jsonb(closed) from closed;
  answer:=jsonb_build_object('id',p_id,'version',c.version+1);update public.rh_oop_requests set response=answer where id=p_request_id;return answer;
end; $$;

-- Read functions run as the caller, so aggregates and pagination obey exactly the same RLS.
create or replace function public.rh_oop_workspace(p_from date,p_to date,p_person text default null,p_team text default null,p_current boolean default false,p_offset integer default 0,p_limit integer default 30,p_include_voided boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer jsonb;
begin
  perform rh_private.oop_require_user();
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset<0 then raise exception 'Seleciona um período até 366 dias e paginação válida.';end if;
  with visible as materialized (
    select c.* from public.rh_oop_contacts c where c.occurred_at>=(p_from::timestamp at time zone 'Europe/Lisbon') and c.occurred_at<((p_to+1)::timestamp at time zone 'Europe/Lisbon')
      and (nullif(p_person,'') is null or c.person_ref=p_person) and (nullif(p_team,'') is null or c.ce_ref=p_team)
      and (not p_current or public.is_rh_admin() or rh_private.oop_current_member(c.person_ref))
  ), filtered as materialized(select * from visible where voided_at is null),stage_data as (select f.id,f.end_stage,s.* from filtered f cross join lateral jsonb_to_recordset(f.data->'stages') as s(stage integer,status text,note text) where f.effective),
  counts as (select count(*) as contacts,count(*) filter(where effective) as effective,count(*) filter(where not effective) as no_conversation,
      count(*) filter(where outcome in ('tv','both')) as tv,count(*) filter(where outcome in ('energy','both')) as energy,
      count(*) filter(where outcome in ('tv','energy','both')) as sales_contacts,count(*) filter(where effective and product in ('tv','both')) as tv_opportunities,
      count(*) filter(where effective and product in ('energy','both')) as energy_opportunities,count(*) filter(where outcome='refusal') as refusals from filtered),
  stages as(select n as stage,count(*) filter(where status<>'not_reached') as reached,count(*) filter(where status='good') as good,
      count(*) filter(where status='difficulty') as difficulty,count(*) filter(where status='omitted') as omitted,count(*) filter(where status='unobserved') as unobserved,
      count(*) filter(where status='no_objections') as no_objections,count(*) filter(where status='not_reached') as not_reached,count(*) filter(where end_stage=n) as ended
    from generate_series(1,7) n left join stage_data s on s.stage=n group by n),
  sellers as(select person_ref,(array_agg(person_name order by occurred_at desc,id))[1] as person_name,count(*) filter(where effective) as effective,count(*) filter(where outcome in ('tv','both')) as tv,
      count(*) filter(where outcome in ('energy','both')) as energy,count(*) filter(where effective and product in ('tv','both')) as tv_opportunities,
      count(*) filter(where effective and product in ('energy','both')) as energy_opportunities,count(*) filter(where outcome='refusal') as refusals from filtered group by person_ref),
  teams as(select ce_ref,(array_agg(ce_name order by occurred_at desc,id))[1] as ce_name,count(*) filter(where effective) as effective,count(*) filter(where outcome in ('tv','both')) as tv,count(*) filter(where outcome in ('energy','both')) as energy,count(*) filter(where outcome='refusal') as refusals from filtered group by ce_ref),
  days as(select (occurred_at at time zone 'Europe/Lisbon')::date::text as date,count(*) filter(where effective) as effective,count(*) filter(where outcome in ('tv','both')) as tv,count(*) filter(where outcome in ('energy','both')) as energy,count(*) filter(where outcome='refusal') as refusals from filtered group by 1),
  reasons as(select reason,count(*) as count from filtered where outcome='refusal' group by reason),
  page as(select * from visible where p_include_voided or voided_at is null order by occurred_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('counts',(select to_jsonb(counts) from counts),'stages',(select jsonb_agg(to_jsonb(stages) order by stage) from stages),
    'sellers',coalesce((select jsonb_agg(to_jsonb(sellers) order by effective desc,person_name) from sellers),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(to_jsonb(teams) order by effective desc,ce_name) from teams),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(to_jsonb(days) order by date) from days),'[]'::jsonb),
    'reasons',coalesce((select jsonb_agg(to_jsonb(reasons) order by count desc) from reasons),'[]'::jsonb),
    'contacts',coalesce((select jsonb_agg(to_jsonb(page) order by occurred_at desc,id) from page),'[]'::jsonb),
    'total',(select count(*) from visible where p_include_voided or voided_at is null),'official',jsonb_build_object('available',false)) into answer;
  return answer;
end; $$;
create or replace function public.rh_oop_context() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform rh_private.oop_require_user();
  return (with visible_people as (
    select p.id,p.name,p.data->>'photo' as photo,p.chefe_id as ce_id,m.name as ce_name,p.ativo as active,p.role_code as role,public.is_rh_admin() or rh_private.oop_current_member(p.id) as current_member
      from public.rh_persons p left join public.rh_persons m on m.id=p.chefe_id
      where (p.role_code='vendedor' and (public.is_rh_admin() or rh_private.oop_current_member(p.id)))
        or exists(select 1 from public.rh_oop_contacts c where c.person_ref=p.id and rh_private.oop_can_read(c.person_ref,c.ce_ref))
    union all
    select distinct on(c.person_ref) c.person_ref,c.person_name,null,null,null,false,'historical',false from public.rh_oop_contacts c
      where not exists(select 1 from public.rh_persons p where p.id=c.person_ref) and rh_private.oop_can_read(c.person_ref,c.ce_ref)
  ), team_names as (
    select id,name,data->>'photo' as photo,0 as priority from public.rh_persons where role_code in ('chefe_equipa','coordenador','capitao') and (public.is_rh_admin() or id=rh_private.oop_manager())
    union all select ce_ref,ce_name,null,1 from public.rh_oop_contacts where rh_private.oop_can_read(person_ref,ce_ref)
  ), teams as(select distinct on(id) id,name,photo from team_names order by id,priority,name)
  select jsonb_build_object('version',1,'profile',(select jsonb_build_object('user_id',user_id,'role',role,'person_id',person_id,'name',display_name) from public.user_profiles where user_id=auth.uid()),
    'people',coalesce((select jsonb_agg(to_jsonb(p) order by name) from visible_people p),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(to_jsonb(t) order by name) from teams t),'[]'::jsonb)));
end; $$;
create or replace function public.rh_oop_action_list(p_person text default null,p_team text default null,p_status text default 'active',p_offset integer default 0,p_limit integer default 30,p_current boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform rh_private.oop_require_user();
  if p_limit is null or p_offset is null or p_status is null or p_limit not between 1 and 100 or p_offset<0 or p_status not in ('active','all','done','cancelled') then raise exception 'Filtro de ações inválido.';end if;
  return (with filtered as materialized(select * from public.rh_oop_actions where (nullif(p_person,'') is null or person_ref=p_person) and (nullif(p_team,'') is null or ce_ref=p_team)
      and (not p_current or public.is_rh_admin() or rh_private.oop_current_member(person_ref))
      and (p_status='all' or p_status='active' and status in ('open','in_progress') or status=p_status)),
    page as(select * from filtered order by due_at,id limit p_limit offset p_offset)
    select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(to_jsonb(page) order by due_at,id) from page),'[]'::jsonb)));
end; $$;
create or replace function public.rh_oop_contact(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform rh_private.oop_require_user();
  return (select to_jsonb(c) from public.rh_oop_contacts c where id=p_id);
end; $$;
create or replace function public.rh_oop_action(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform rh_private.oop_require_user();
  return (select to_jsonb(a) from public.rh_oop_actions a where id=p_id);
end; $$;
create or replace function public.rh_oop_revisions(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform rh_private.oop_require_user();
  return coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from (select * from public.rh_oop_revisions where target_id=p_id order by created_at desc limit 50) r),'[]'::jsonb);
end; $$;
revoke all on function rh_private.oop_manager(),rh_private.oop_current_member(text),rh_private.oop_can_read(text,text),rh_private.oop_require_user(),rh_private.oop_request(uuid,text,uuid,jsonb),rh_private.oop_generic(text) from public,anon,authenticated;
grant execute on function rh_private.oop_manager(),rh_private.oop_current_member(text),rh_private.oop_can_read(text,text),rh_private.oop_require_user() to authenticated;
revoke all on function public.rh_oop_save_contact(uuid,integer,jsonb,uuid,uuid),public.rh_oop_save_action(uuid,integer,jsonb,uuid,uuid),public.rh_oop_void_contact(uuid,integer,text,uuid,uuid),public.rh_oop_workspace(date,date,text,text,boolean,integer,integer,boolean),public.rh_oop_context(),public.rh_oop_action_list(text,text,text,integer,integer,boolean),public.rh_oop_revisions(uuid),public.rh_oop_contact(uuid),public.rh_oop_action(uuid) from public,anon;
grant execute on function public.rh_oop_save_contact(uuid,integer,jsonb,uuid,uuid),public.rh_oop_save_action(uuid,integer,jsonb,uuid,uuid),public.rh_oop_void_contact(uuid,integer,text,uuid,uuid),public.rh_oop_workspace(date,date,text,text,boolean,integer,integer,boolean),public.rh_oop_context(),public.rh_oop_action_list(text,text,text,integer,integer,boolean),public.rh_oop_revisions(uuid),public.rh_oop_contact(uuid),public.rh_oop_action(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
