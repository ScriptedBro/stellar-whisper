-- Stellar Whisper Indexer Schema

create table if not exists events (
  id text primary key,
  type text not null default 'contract',
  ledger bigint not null,
  ledger_closed_at text,
  contract_id text not null,
  tx_hash text,
  topic jsonb default '[]'::jsonb,
  value text,
  token_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_contract_id on events(contract_id);
create index if not exists idx_events_ledger on events(ledger desc);
create index if not exists idx_events_tx_hash on events(tx_hash);

create table if not exists sync_state (
  key text primary key,
  value text not null
);
