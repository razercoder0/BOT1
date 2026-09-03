create table if not exists public.bot_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_state enable row level security;

revoke all on table public.bot_state from anon, authenticated;
grant select, insert, update, delete on table public.bot_state to service_role;

comment on table public.bot_state is
  'Estado persistente do bot de clans. Acesso permitido somente pela chave secreta do servidor.';
