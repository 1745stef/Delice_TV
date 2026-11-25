# 🔮 Delice_TV

Grille de Bingo en temps réel pour Delice_TV, thème magique rouge et or.

- **Admin** : ajoute du texte et/ou une image dans chaque case, révèle les cases, ouvre et ferme la grille.
- **Joueur** : attend devant une sphère, puis voit la grille s'ouvrir (confettis) et les cases se révéler **en direct**, sans recharger.
- Les cases cachées ne sont **jamais** envoyées au navigateur des joueurs.

Ce projet partage la **même base Supabase** que l'app principale : mêmes usagers, mêmes mots de passe, mêmes droits.

```
backend/    API Express (connexion + routes Bingo)   → Render
frontend/   React + Vite                               → Netlify
supabase_bingo.sql   tables du Bingo (à exécuter une seule fois si ce n'est pas déjà fait)
```

## Mise en ligne (gratuit)

### 1. Supabase
Aucune nouvelle base. Si tu as déjà exécuté `supabase_bingo.sql` de l'app principale (v1.4.0 ou plus), **il n'y a rien à faire**. Sinon, exécute-le une fois dans *SQL Editor* (il est sans danger si relancé).

### 2. GitHub
Crée un nouveau dépôt et pousse ce dossier tel quel (`.env` est ignoré par `.gitignore`).

### 3. Render — le backend
*New → Web Service* → choisis le dépôt (ou *New → Blueprint*, qui lit `render.yaml`).

| Réglage | Valeur |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path | `/health` |

Variables d'environnement :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | la même que l'app principale |
| `SUPABASE_SERVICE_KEY` | la même que l'app principale (clé *service_role*) |
| `JWT_SECRET` | une longue chaîne aléatoire (pas besoin qu'elle soit la même qu'ailleurs) |
| `FRONTEND_URL` | l'adresse Netlify du Bingo, voir étape 5 |

### 4. Netlify — le frontend
*Add new site → Import from Git* → choisis le dépôt. `netlify.toml` règle déjà le dossier (`frontend`), la commande et le dossier publié (`dist`).

Variables d'environnement :

| Variable | Valeur |
|---|---|
| `VITE_API_URL` | l'adresse Render du backend, sans `/` à la fin |
| `VITE_SUPABASE_URL` | *(facultatif)* l'URL Supabase — par défaut, celle de l'app principale |
| `VITE_SUPABASE_ANON_KEY` | *(facultatif)* la clé *anon* — par défaut, celle de l'app principale |

Puis déploie. Pour un nom de domaine à toi : *Domain management → Add a domain* (le domaine doit t'appartenir ; sinon l'adresse gratuite en `.netlify.app` convient).

### 5. Boucler la boucle
Retourne dans Render et mets l'adresse Netlify dans `FRONTEND_URL` (ex. `https://delice-tv.netlify.app`, sans `/` final ; plusieurs adresses possibles, séparées par des virgules). Render redémarre tout seul.

## Premier accès

1. Ouvre le site et connecte-toi avec ton compte habituel.
2. Un **superadmin** (rôle de niveau 1) voit le bouton **⚙ Réglages** : il y choisit, pour chaque usager, *Aucun / Joueur / Admin*, la taille de la grille.
3. Tant que rien n'est enregistré, seul `stephane` est admin du Bingo.
4. Les droits du Bingo sont les mêmes que dans l'app principale (même table) : on peut les régler depuis l'un ou l'autre.

## À savoir

- **Reconnexion** : chaque adresse a sa propre session, les usagers se connectent donc une fois sur ce site (mêmes identifiants).
- **Comptes** : la création de compte et les réinitialisations de mot de passe restent dans l'app principale.
- **Render gratuit** : le serveur s'endort après 15 minutes sans trafic et met jusqu'à une minute à se réveiller. Ouvre la page quelques minutes avant la partie. Les 750 heures gratuites sont partagées entre tous tes services Render.
- **Supabase gratuit** : un projet inactif est mis en pause après 7 jours ; le temps réel est limité à 200 connexions simultanées (partagées avec l'app principale).
- **Images** : rangées dans le bucket Supabase `avatars`, sous `bingo/`.

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
