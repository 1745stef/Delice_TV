-- ═══════════════════════════════════════════════════════════════════════════
-- Bingo — à exécuter UNE FOIS dans Supabase (SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════

-- Contenu complet de chaque case. RLS activé SANS policy : invisible pour la clé
-- anon, seul le backend (clé service) y accède. Les joueurs ne peuvent donc pas
-- lire les cases cachées.
create table if not exists bingo_cells (
  position   int primary key,
  text       text,
  image_url  text,
  revealed   boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table bingo_cells enable row level security;

-- Copie des cases RÉVÉLÉES seulement. Lisible par tous (c'est ce qui alimente le
-- temps réel côté joueur). Le backend y ajoute / retire une ligne à chaque
-- révélation / masquage.
create table if not exists bingo_public (
  position    int primary key,
  text        text,
  image_url   text,
  revealed_at timestamptz not null default now()
);
alter table bingo_public enable row level security;

drop policy if exists "bingo_public_read" on bingo_public;
create policy "bingo_public_read" on bingo_public
  for select to anon, authenticated using (true);

-- Active le temps réel (postgres_changes) sur bingo_public
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bingo_public'
  ) then
    alter publication supabase_realtime add table bingo_public;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- v1.4.0 — Grille ouverte / fermée (une seule ligne, id = 1)
-- Lisible par tous + temps réel : c'est ce qui déclenche les confettis chez les joueurs.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists bingo_state (
  id         int primary key default 1 check (id = 1),
  active     boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into bingo_state (id, active) values (1, false) on conflict (id) do nothing;
alter table bingo_state enable row level security;

drop policy if exists "bingo_state_read" on bingo_state;
create policy "bingo_state_read" on bingo_state
  for select to anon, authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bingo_state'
  ) then
    alter publication supabase_realtime add table bingo_state;
  end if;
end $$;
