import { useEffect, useState } from 'react';

// Avatar d'un usager : photo téléversée, image par lien, ou lettre sur fond de couleur (comme Pool Olympique)
export default function Avatar({ user, size = 36 }) {
  const name = user?.display_name || user?.username || '?';
  const src = user?.avatar_type === 'upload' ? user.avatar_url
    : user?.avatar_type === 'url' ? user.avatar_url_external : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  const box = { width: size, height: size };
  if (src && !broken) {
    return <img className="avatar" src={src} alt="" style={box} onError={() => setBroken(true)} />;
  }
  return (
    <span className="avatar avatar-letter"
      style={{ ...box, fontSize: size * 0.46, background: user?.avatar_color || '#7a1020', color: user?.avatar_text_color || '#f3d97a' }}>
      {name[0].toUpperCase()}
    </span>
  );
}
