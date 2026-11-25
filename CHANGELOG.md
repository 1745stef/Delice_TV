# Changelog

Format : [semver](https://semver.org/) — MAJEUR.MINEUR.CORRECTIF

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
