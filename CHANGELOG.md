# Changelog

Format : [semver](https://semver.org/) — MAJEUR.MINEUR.CORRECTIF

## [2.1.1]
### Modifié
- **Les images des dos de cartes ne sont plus coupées** : le casse-tête, le dos des gages et le dos du toupet suprême s'affichent **en entier, centrés, sans déformation** (avant : l'image était recadrée pour remplir). Si ses proportions diffèrent de celles de la grille, du velours rouge complète les bords. Gestion → Bingo indique le format idéal (ex. 5:5, carré).
- Aucune mise à jour de base ni de backend : seul le frontend change.

## [2.1.0]
### Ajouté
- **Image du casse-tête** : une image découpée en autant de morceaux que la grille a de cases ; chaque case encore cachée en montre un. Elle se redécoupe toute seule si la taille de la grille change.
- **Dos des gages** : une image unique, répétée sur toutes les cartes gage (lignes, colonnes, diagonale).
- **Dos du toupet suprême** : une image distincte pour la dernière carte (l'ancienne « carte pleine », renommée **Toupet suprême**).
- Ces trois images se règlent dans Gestion → Bingo (envoi, remplacement, retrait). Sans image, le style rouge et or reste.
- **Droits de groupe détaillés** : les cases à cocher sont rangées en *Rôles dans le Bingo* (Admin / Streamer / Spectateur), *Écrans* et *Paramètres*.
- **Accès aux paramètres** (la porte d'entrée de l'onglet Gestion) + une case distincte par section : **Profils des joueurs** (voir les profils, réinitialiser les mots de passe), **Paramètres du Bingo**, **Paramètres du streamer** (vide pour l'instant). Cocher une section coche aussi la porte.
- L'onglet Gestion n'affiche que les sections auxquelles la personne a droit. Exemple : Samba (profils + Bingo, sans streamer) et Drity (Bingo + streamer, sans mots de passe).
- Sécurité : on ne peut réinitialiser le mot de passe que d'un compte qui n'a **pas plus de droits que soi** (sinon on pourrait prendre sa place). Le compte d'un super admin est protégé.

### Modifié
- **Le profil est ouvert à toute personne connectée, même sans groupe** : un nouvel inscrit arrive sur son profil (nom affiché, avatar) et rien d'autre. Ce n'est plus un droit de groupe.
- Les groupes, leurs droits, l'ajout de personnes à un groupe et la suppression de comptes restent réservés au super admin.

### Mise à jour
- Rien d'obligatoire côté base. Si `supabase_delice.sql` 2.0.0 a déjà été exécuté, le relancer retire simplement l'ancien droit « profile » (ou exécuter : `delete from delice_group_modules where module_key = 'profile';`).
- Redéployer le backend et le frontend.

## [2.0.0]
Delice_TV a maintenant **ses propres comptes**, des **groupes modulables** et un contrôle de ce que chaque groupe voit.

### Ajouté
- **Table `delice_users`** : les inscrits de Delice, séparés de ceux de Pool Olympique. Les 3 comptes existants sont copiés par le script SQL (mêmes identifiants et mots de passe).
- **Super admin** (toi) : voit tout et gère tout. Désigné dans la base (`is_superadmin`), jamais modifiable depuis le site.
- **Inscription** depuis la page de connexion. Un inscrit n'est dans aucun groupe : il arrive sur un écran vide.
- **Groupes modulables** (onglet Gestion) : on en crée au besoin, on y met des gens, une personne peut être dans plusieurs groupes. Groupes de départ : Admins, Streamer, Joueurs.
- **Modules** : chaque groupe choisit ce que ses membres voient — Bingo (spectateur / streamer / admin), Profil, Twitch (page « bientôt »). Les droits s'appliquent immédiatement, sans reconnexion.
- **Profil** repris de Pool Olympique : nom affiché, avatar lettre colorée, photo recadrée ou lien d'image.
- **Gestion** : usagers (groupes, mot de passe temporaire, suppression), groupes, taille de la grille du Bingo.
- **Carte pleine** : une case supplémentaire tout en bas du Bingo, que le streamer ne peut dévoiler que lorsque TOUTES les cases sont révélées.
- Protection contre les abus : 5 comptes créés par heure et 10 échecs de connexion par 15 minutes, par adresse IP.

### Modifié
- **Le Bingo tient sur l'écran, sans défilement** : la grille s'adapte à la place disponible (ordinateur et téléphone).
- Les droits du Bingo passent par les modules des groupes (plus de liste d'admins / joueurs).
- Le streamer dévoile un gage avec le droit « Bingo — streamer ». L'aperçu d'un admin reste en lecture seule (sauf s'il a aussi ce droit).
- Les canaux temps réel sont séparés par table : une table manquante ne casse plus les autres.
- Messages d'erreur clairs si la base n'est pas à jour.
- La carte d'un gage qui « brillait sans réagir » : elle ne brille plus en aperçu lecture seule, et toute erreur du serveur s'affiche.

### ⚠️ Mise à jour — à faire une seule fois
1. Dans Supabase (SQL Editor), exécuter **`supabase_delice.sql`** (nouvelle table des inscrits + copie des 3 comptes + super admin). Puis `supabase_bingo.sql` s'il n'a jamais été exécuté depuis la 1.1.0 (tables des gages). Les deux sont sans danger si relancés.
2. Redéployer le backend et le frontend.
3. Te connecter avec ton compte habituel, ouvrir **Gestion** et ajouter les gens aux groupes.

## [1.1.0]
### Ajouté
- **Gages** : une carte au bout de chaque ligne, sous chaque colonne et dans le coin bas-droit pour la diagonale haut-gauche → bas-droite (grille carrée seulement).
- Les admins définissent chaque gage (texte et/ou image). Il reste caché : le serveur ne l'envoie jamais au joueur avant qu'il le dévoile.
- Le joueur (le streamer) dévoile lui-même un gage en cliquant sur le dos de la carte, **seulement quand la ligne est réalisée** (toutes ses cases révélées). La règle est vérifiée côté serveur. Pas d'œil ni de cadenas côté joueur.
- Le dévoilement se voit en direct chez tous, avec retournement de la carte.
- Vue admin : badges « Réalisée » / « Dévoilé » / « Gage manquant ! », bouton « Remettre face cachée ».
- L'aperçu « Vue joueur » d'un admin est en lecture seule (il ne peut pas dévoiler un gage).

### ⚠️ Mise à jour — à faire une seule fois
1. **Ré-exécuter `supabase_bingo.sql`** dans Supabase (sans danger : il ne recrée pas ce qui existe). Il ajoute `bingo_gages` et `bingo_gages_public`.
2. Redéployer le backend et le frontend.

## [1.0.1]
### Modifié
- Le projet s'appelle maintenant **Delice_TV** (onglet du navigateur, connexion, barre du haut, paquets, service Render).
- Réglages : le champ « Titre » est retiré (le titre de la barre du haut est fixe ; ce réglage était partagé avec l'app principale).

## [1.0.0]
Projet autonome extrait du Pool Olympique (version 1.4.1), avec sa propre connexion.

### Ajouté
- Page de **connexion** (mêmes comptes et mots de passe que l'app principale) et changement de mot de passe obligatoire après une réinitialisation.
- **Thème magique rouge et or** (velours rouge, parchemin, bordures dorées, étoiles scintillantes).
- Backend et frontend dédiés au Bingo (grille ouverte/fermée, cases texte/image, révélation en temps réel, animations Lottie).
- Réglages superadmin intégrés : titre, taille de la grille, rôle (Aucun / Joueur / Admin) de chaque usager.
- Écran « serveur en réveil » pour l'hébergement gratuit Render.
- `render.yaml` (Render) et `netlify.toml` (Netlify).
