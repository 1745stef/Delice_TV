// Droits assignables à un groupe. La liste est fixée dans le code ; ce sont les GROUPES
// (modifiables dans Gestion) qui décident lesquels sont accordés. Le super admin a toujours tout.
//
//  • roles    : le rôle dans le Bingo (Admin / Streamer / Spectateur)
//  • screens  : écrans supplémentaires
//  • settings : l'onglet Gestion. « settings » est la porte d'entrée ; chaque section a sa propre case.
//
// Le profil (nom, avatar) n'est PAS un droit : toute personne connectée peut modifier le sien,
// même sans groupe. Les groupes, leurs droits et la suppression de comptes restent réservés au super admin.
export const MODULES = [
  { key: 'bingo.admin',  category: 'roles',    label: 'Bingo — Admin',       description: 'Prépare la grille, révèle les cases, écrit les gages, ouvre et ferme la grille' },
  { key: 'bingo.stream', category: 'roles',    label: 'Bingo — Streamer',    description: 'Voit la grille et dévoile les gages (c\'est lui qui joue)' },
  { key: 'bingo.view',   category: 'roles',    label: 'Bingo — Spectateur',  description: 'Regarde la grille et les cases révélées en direct' },
  { key: 'twitch',       category: 'screens',  label: 'Compte Twitch (bientôt)', description: 'Page pour lier son compte Twitch' },
  { key: 'settings',          category: 'settings', label: 'Accès aux paramètres',   description: 'Affiche l\'onglet Gestion (porte d\'entrée : cocher une section l\'active aussi)' },
  { key: 'settings.users',    category: 'settings', parent: 'settings', label: 'Profils des joueurs',      description: 'Voir les profils et réinitialiser les mots de passe' },
  { key: 'settings.bingo',    category: 'settings', parent: 'settings', label: 'Paramètres du Bingo',      description: 'Taille de la grille, images du casse-tête, des gages et du toupet suprême' },
  { key: 'settings.streamer', category: 'settings', parent: 'settings', label: 'Paramètres du streamer',   description: 'Réglages du streamer (Twitch, bientôt)' },
];

export const MODULE_KEYS = new Set(MODULES.map(m => m.key));

export const cleanModuleKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : []).filter(k => MODULE_KEYS.has(k)))];

// Cocher une section de paramètres coche aussi la porte « settings ».
export function normalizeModuleKeys(keys) {
  const set = new Set(cleanModuleKeys(keys));
  if ([...set].some(k => k.startsWith('settings.'))) set.add('settings');
  return [...set];
}

// Droits effectifs : le super admin a tout, les autres ont l'union de leurs groupes.
export function computeModules({ isSuper, groupModuleKeys }) {
  return isSuper ? [...MODULE_KEYS] : normalizeModuleKeys(groupModuleKeys);
}

// Réinitialiser le mot de passe de quelqu'un = pouvoir se connecter à sa place.
// On l'interdit donc pour un compte qui a PLUS de droits que soi (sinon : escalade de privilèges).
//  • le compte d'un super admin : seulement par un super admin
//  • un super admin peut tout réinitialiser
//  • sinon : seulement si les droits de la cible sont inclus dans les siens
export function canResetPassword({ requesterIsSuper, requesterModules, targetIsSuper, targetModules }) {
  if (targetIsSuper) return !!requesterIsSuper;
  if (requesterIsSuper) return true;
  return (targetModules || []).every(m => (requesterModules || []).includes(m));
}
