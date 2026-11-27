# 🔮 Delice_TV

Bingo en temps réel pour Delice_TV (thème magique rouge et or), avec comptes, groupes et profils.

- **Admins** : préparent la grille et les gages, révèlent les cases, ouvrent et ferment la grille.
- **Streamer** (celui qui joue) : voit la grille se révéler en direct et dévoile lui-même les gages quand une ligne est réalisée.
- **Les autres** : ne voient que ce que leurs groupes leur montrent.
- Les cases et gages cachés ne sont **jamais** envoyés au navigateur des joueurs.

Ce projet partage la **même base Supabase** que Pool Olympique, mais ses comptes sont dans leur propre table (`delice_users`).

```
backend/    API Express (comptes, groupes, Bingo)   → Render
frontend/   React + Vite                              → Netlify
supabase_delice.sql   comptes, groupes, modules (+ copie des 3 comptes et super admin)
supabase_bingo.sql    tables du Bingo et des gages
```

## Mise en ligne (gratuit)

### 1. Supabase
Dans *SQL Editor*, exécute **`supabase_delice.sql`**, puis **`supabase_bingo.sql`**. Les deux sont **sans danger si relancés** (ils ne recréent que ce qui manque). À refaire quand le `CHANGELOG.md` l'indique.

### 2. GitHub
Crée un nouveau dépôt et pousse ce dossier (`.env` est ignoré par `.gitignore`).

### 3. Render — le backend
*New → Web Service* → choisis le dépôt (ou *New → Blueprint*, qui lit `render.yaml`).

| Réglage | Valeur |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path | `/health` |

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | celle de ton projet Supabase |
| `SUPABASE_SERVICE_KEY` | la clé secrète (*service_role*) de ton projet |
| `JWT_SECRET` | une longue chaîne aléatoire |
| `FRONTEND_URL` | l'adresse Netlify du site (étape 5) |

### 4. Netlify — le frontend
*Add new site → Import from Git* → choisis le dépôt. `netlify.toml` règle déjà le dossier (`frontend`), la commande et le dossier publié (`dist`).

| Variable | Valeur |
|---|---|
| `VITE_API_URL` | l'adresse Render du backend, sans `/` à la fin |
| `VITE_SUPABASE_URL` | *(facultatif)* par défaut, celle de Pool Olympique (même projet) |
| `VITE_SUPABASE_ANON_KEY` | *(facultatif)* la clé *anon* (publique) |

### 5. Boucler la boucle
Mets l'adresse Netlify dans `FRONTEND_URL` côté Render (sans `/` final ; plusieurs adresses possibles, séparées par des virgules).

## Comptes, groupes et droits

- **Super admin** : le compte `0a032b27-…` (copié depuis Pool Olympique par le script SQL). Il voit tout et a l'onglet **⚙ Gestion**. Ce statut ne peut pas être donné depuis le site.
- **Inscription** : depuis la page de connexion. Un nouvel inscrit n'est dans **aucun groupe** : il arrive sur son **profil** (nom affiché, avatar) et ne voit rien d'autre. Le profil est ouvert à tout le monde.
- **Gestion → Profils des joueurs** : le super admin ajoute les gens aux groupes (une personne peut être dans plusieurs groupes), génère un mot de passe temporaire, supprime un compte. Les inscrits sans groupe sont signalés.
- **Gestion → Groupes** (super admin seulement) : on crée autant de groupes que voulu et on coche, pour chacun, ses droits. Quelqu'un dans plusieurs groupes a la somme de leurs droits. Les changements s'appliquent tout de suite, sans reconnexion.
- **Gestion → Bingo** : taille de la grille et images (casse-tête, dos des gages, dos du toupet suprême).

Groupes créés au départ (modifiables) : **Admins** (Bingo admin), **Streamer** (Bingo streamer + Twitch), **Joueurs** (aucun droit — à définir plus tard).

### Droits d'un groupe

| Rubrique | Droit | Ce que ça donne |
|---|---|---|
| Rôles dans le Bingo | Admin | prépare la grille, révèle les cases, écrit les gages, ouvre / ferme la grille |
| | Streamer | voit la grille et dévoile les gages (c'est lui qui joue) |
| | Spectateur | regarde la grille et les cases révélées en direct |
| Écrans | Compte Twitch (bientôt) | page prévue pour lier son compte Twitch |
| Paramètres | **Accès aux paramètres** | affiche l'onglet Gestion (la porte d'entrée) |
| | Profils des joueurs | voir les profils, réinitialiser les mots de passe |
| | Paramètres du Bingo | taille de la grille, images des cartes |
| | Paramètres du streamer | réglages du streamer (vide pour l'instant) |

Cocher une section de paramètres coche aussi *Accès aux paramètres*. Exemple : **Samba** = profils + Bingo (pas le streamer) ; **Drity** = Bingo + streamer (pas les mots de passe).

- Seul le super admin gère les groupes et leurs droits, place les gens dans les groupes et supprime des comptes.
- On ne peut réinitialiser le mot de passe que d'un compte qui n'a **pas plus de droits que soi** (sinon on pourrait se connecter à sa place). Le compte d'un super admin n'est réinitialisable que par un super admin.

## Le Bingo

- La grille tient sur l'écran, sans défilement (ordinateur et téléphone).
- **Gages** : une carte au bout de chaque ligne (à droite), sous chaque colonne (en bas) et dans le coin pour la diagonale haut-gauche → bas-droite (grille carrée seulement). Les admins écrivent chaque gage (texte et/ou image).
- Une ligne est **réalisée** quand toutes ses cases sont révélées. Le streamer clique alors sur le dos de la carte : elle se retourne, pour tout le monde en direct. Le serveur refuse le clic sinon.
- **Toupet suprême** : la case supplémentaire tout en bas. Elle ne se dévoile que lorsque **toutes** les cases de la grille sont révélées.
- **Dos des cartes** (Gestion → Bingo) : une image découpée en **casse-tête** sur les cases cachées, une image **répétée** sur chaque gage, et une image **unique** sur le toupet suprême. Les images sont toujours affichées **en entier et centrées** (jamais coupées) ; si leurs proportions diffèrent de celles de la carte, du velours rouge complète les bords.
- Un admin peut remettre un gage face cachée (clic par erreur). Fermer la grille ramène tout le monde à l'écran d'attente.
- Pour tester en streamer : crée un compte de test, mets-le dans le groupe *Streamer*. (Le super admin a tous les droits, y compris celui de dévoiler.)

## À savoir

- **Render gratuit** : le serveur s'endort après 15 minutes sans trafic et met jusqu'à une minute à se réveiller (l'écran de connexion l'indique). Ouvre la page quelques minutes avant la partie.
- **Supabase gratuit** : un projet inactif est mis en pause après 7 jours ; le temps réel est limité à 200 connexions simultanées.
- **Images** : rangées dans le bucket Supabase `avatars` (avatars sous `delice/`, Bingo sous `bingo/`).
- **Mots de passe** : un mot de passe temporaire (généré dans Gestion) oblige à en choisir un nouveau à la connexion.

## Développement local

```bash
# backend
cd backend
cp .env.example .env      # puis remplir les valeurs
npm install
npm run dev               # http://localhost:3001

# frontend (autre terminal)
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## Personnaliser

- **Couleurs et polices** : variables en haut de `frontend/src/styles.css`.
- **Animations** (sphère, confettis, baguette) : adresses dans `frontend/src/bingo/animations.js`.
- **Ajouter un droit** : l'ajouter dans `backend/src/modules.js` (la liste), puis lui donner son écran dans `frontend/src/App.jsx`.
