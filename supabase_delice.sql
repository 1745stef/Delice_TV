-- ═══════════════════════════════════════════════════════════════════════════
-- Delice_TV v2.1.0 — comptes, groupes et droits
-- À exécuter dans Supabase (SQL Editor). Sans danger si relancé : il ne recrée
-- et ne recopie que ce qui manque, et ne touche JAMAIS aux tables de Pool Olympique.
-- (Les tables du Bingo restent dans supabase_bingo.sql.)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Table des inscrits Delice (séparée de la table « users » de Pool Olympique)
create table if not exists delice_users (
  id                   uuid primary key default gen_random_uuid(),
  username             text not null unique,
  password_hash        text not null,
  temp_password_hash   text,
  must_change_password boolean not null default false,
  is_superadmin        boolean not null default false,
  display_name         text,
  avatar_type          text not null default 'letter' check (avatar_type in ('letter', 'upload', 'url')),
  avatar_url           text,
  avatar_url_external  text,
  avatar_color         text default '#7a1020',
  avatar_text_color    text default '#f3d97a',
  created_at           timestamptz default now()
);

-- 2) Groupes (modulables : on en ajoute au besoin dans Gestion)
create table if not exists delice_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  color       text default '#d4af37',
  created_at  timestamptz default now()
);

-- 3) Qui est dans quel groupe (une personne peut être dans plusieurs groupes)
create table if not exists delice_user_groups (
  user_id  uuid not null references delice_users(id)  on delete cascade,
  group_id uuid not null references delice_groups(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (user_id, group_id)
);

-- 4) Ce que chaque groupe voit à l'écran (modules)
create table if not exists delice_group_modules (
  group_id   uuid not null references delice_groups(id) on delete cascade,
  module_key text not null,
  primary key (group_id, module_key)
);

-- 5) Réglages (taille de la grille du Bingo, …)
create table if not exists delice_settings (
  key   text primary key,
  value text not null
);

-- Sécurité : RLS activé SANS policy → invisibles pour la clé « anon »,
-- seul le backend (clé service) y accède.
alter table delice_users         enable row level security;
alter table delice_groups        enable row level security;
alter table delice_user_groups   enable row level security;
alter table delice_group_modules enable row level security;
alter table delice_settings      enable row level security;

-- 6) Groupes de départ (créés seulement s'ils n'existent pas ; modifiables ensuite dans Gestion)
do $$
declare gid uuid;
begin
  if not exists (select 1 from delice_groups where name = 'Admins') then
    insert into delice_groups (name, description, color)
      values ('Admins', 'Préparent la grille et les gages', '#c8182b') returning id into gid;
    insert into delice_group_modules (group_id, module_key) values (gid, 'bingo.admin');
  end if;

  if not exists (select 1 from delice_groups where name = 'Streamer') then
    insert into delice_groups (name, description, color)
      values ('Streamer', 'Celui qui joue au Bingo', '#d4af37') returning id into gid;
    insert into delice_group_modules (group_id, module_key) values (gid, 'bingo.stream'), (gid, 'twitch');
  end if;

  if not exists (select 1 from delice_groups where name = 'Joueurs') then
    insert into delice_groups (name, description, color)
      values ('Joueurs', 'Rôle à définir plus tard', '#8a6a2a') returning id into gid;
    -- aucun droit pour l'instant : à définir plus tard dans Gestion
  end if;
end $$;

-- Le profil n'est plus un droit de groupe : toute personne connectée peut modifier le sien.
-- (Nettoyage de l'ancien droit « profile » si le script 2.0.0 avait été exécuté.)
delete from delice_group_modules where module_key = 'profile';

-- 7) COPIE des 3 comptes depuis « users » (mêmes identifiants, mêmes mots de passe)
insert into delice_users (
  id, username, password_hash, temp_password_hash, must_change_password,
  avatar_type, avatar_url, avatar_url_external, avatar_color, avatar_text_color, created_at
)
select
  id, username, password_hash, temp_password_hash, coalesce(must_change_password, false),
  coalesce(avatar_type, 'letter'), avatar_url, avatar_url_external,
  coalesce(avatar_color, '#7a1020'), coalesce(avatar_text_color, '#f3d97a'), coalesce(created_at, now())
from users
where id in (
  '0a032b27-3902-4b34-83b0-6cede934d23e'::uuid,
  'de06919e-1e11-49b0-84e1-b958de0982a4'::uuid,
  'ec43e8cc-b82d-4208-870d-9434c9e149d0'::uuid
)
on conflict do nothing;

-- 8) Super admin : toi
update delice_users set is_superadmin = true
where id = '0a032b27-3902-4b34-83b0-6cede934d23e'::uuid;

-- 9) Vérification : tu dois voir 3 lignes, et is_superadmin = true pour la première
select id, username, is_superadmin, created_at from delice_users order by is_superadmin desc, username;
