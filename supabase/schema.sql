-- Esquema do Supabase do CRM do Sérgio (projeto crm-sergio, sa-east-1), na ordem em que foi aplicado.
-- Referência para recriar o projeto. Não rode de novo num projeto que já tem estas tabelas.

-- 1) Registros do CRM (clientes, vendas, visitas, agenda) — JSON por usuário, "a mais recente vence"
create table public.registros (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo       text not null,
  id         text not null check (length(id) between 1 and 64),
  dados      jsonb,
  deleted    boolean not null default false,
  updated_at bigint not null,
  server_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, tipo, id),
  constraint registros_tipo_check check (tipo in ('clientes','vendas','visitas','agenda','produtos','pedidos'))
);
create index registros_user_server_at on public.registros (user_id, server_at);
create or replace function public.registros_lww() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then return null; end if;
  new.server_at := clock_timestamp(); return new;
end; $$;
create trigger registros_lww before insert or update on public.registros for each row execute function public.registros_lww();
alter table public.registros enable row level security;
create policy "registros_select_own" on public.registros for select to authenticated using (user_id = (select auth.uid()));
create policy "registros_insert_own" on public.registros for insert to authenticated with check (user_id = (select auth.uid()));
create policy "registros_update_own" on public.registros for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.registros from anon, authenticated;
grant select, insert, update on public.registros to authenticated;
revoke execute on function public.registros_lww() from public, anon, authenticated;

-- 2) Notificações (Web Push)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create table public.push_subscriptions (
  endpoint text primary key check (endpoint like 'https://%' and length(endpoint) < 1000),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) < 200),
  auth text not null check (length(auth) < 100),
  tz text not null default 'America/Porto_Velho' check (length(tz) < 64),
  lembrete_min int not null default 30 check (lembrete_min between 0 and 1440),
  resumo_hora text default '07:00' check (resumo_hora is null or resumo_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  user_agent text check (length(user_agent) < 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push_sub_select_own" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "push_sub_insert_own" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "push_sub_update_own" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push_sub_delete_own" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create table public.push_envios (
  endpoint text not null references public.push_subscriptions(endpoint) on delete cascade,
  chave text not null,
  enviado_em timestamptz not null default now(),
  primary key (endpoint, chave)
);
alter table public.push_envios enable row level security;
revoke all on public.push_envios from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions, public.push_envios to service_role;
grant select on public.registros to service_role;

-- Segredos gerados dentro do banco (Vault). As chaves VAPID são criadas pela função na 1ª execução.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'crm_cron_secret', 'Segredo do agendador de notificações do CRM');
create function public.crm_secret(nome text) returns text language sql security definer stable set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = nome and nome like 'crm\_%' $$;
revoke execute on function public.crm_secret(text) from public, anon, authenticated;
grant execute on function public.crm_secret(text) to service_role;
create function public.crm_guardar_vapid(pub text, priv text) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'crm_vapid_private') then return false; end if;
  perform vault.create_secret(priv, 'crm_vapid_private', 'Chave VAPID privada (Web Push)');
  perform vault.create_secret(pub,  'crm_vapid_public',  'Chave VAPID pública (Web Push)');
  return true;
end; $$;
revoke execute on function public.crm_guardar_vapid(text, text) from public, anon, authenticated;
grant execute on function public.crm_guardar_vapid(text, text) to service_role;
create function public.crm_vapid_publica() returns text language sql security definer stable set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'crm_vapid_public' $$;
revoke execute on function public.crm_vapid_publica() from public, anon;
grant execute on function public.crm_vapid_publica() to authenticated;

-- 3) Agendador: chama a Edge Function "notificar" a cada 5 minutos
select cron.schedule('crm-notificar', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://lpkasnhyzlvzznsceouk.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='crm_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$job$);
