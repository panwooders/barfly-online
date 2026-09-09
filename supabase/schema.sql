-- Da incollare UNA VOLTA nell'SQL Editor di Supabase (Project > SQL Editor > New query > Run).
--
-- Schema volutamente minimale: una tabella chiave/valore con due righe
-- ("entries" e "topics"), che rispecchia esattamente le due chiavi che il
-- file locale teneva in localStorage. Niente tabelle relazionali separate:
-- per un solo utente non aggiungono nulla, e mantengono identico il formato
-- dati che l'app già usa (stesso JSON di Esporta/Importa).

create table if not exists vocab_kv (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into vocab_kv (key, value) values
  ('entries', '[]'::jsonb),
  ('topics', '[]'::jsonb)
on conflict (key) do nothing;

-- Row Level Security attiva e SENZA policy = nessuno può leggere/scrivere
-- tramite le chiavi pubbliche (anon/authenticated). Solo il server, con la
-- Service Role Key (che salta sempre la RLS), può farlo — ed è l'unica cosa
-- che parla con questa tabella (vedi api/vocab.js).
alter table vocab_kv enable row level security;
