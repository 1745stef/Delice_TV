import { useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { profileApi } from '../lib/api';
import Avatar from '../components/Avatar';
import ImageCropper from '../components/ImageCropper';

const BG_PRESETS   = ['#7a1020', '#a3121f', '#c8182b', '#5c0a16', '#d4af37', '#8a6a2a', '#1a1a2e', '#2e7d32', '#1565c0', '#6a1b9a'];
const TEXT_PRESETS = ['#f3d97a', '#ffffff', '#12060a', '#d4af37'];
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];

// Profil (module « profile ») : nom affiché + avatar — lettre colorée, photo recadrée, ou lien d'image.
export default function ProfilePage() {
  const { user, setUser, access } = useAuth();
  const hasAccess = !!access && (access.is_superadmin || access.modules.length > 0);
  const [name, setName] = useState(user.display_name || '');
  const [type, setType] = useState(user.avatar_type || 'letter');
  const [bg, setBg]     = useState(user.avatar_color || '#7a1020');
  const [fg, setFg]     = useState(user.avatar_text_color || '#f3d97a');
  const [url, setUrl]   = useState(user.avatar_url_external || '');
  const [cropSrc, setCropSrc] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const preview = { ...user, display_name: name || null, avatar_type: type, avatar_color: bg, avatar_text_color: fg, avatar_url_external: url };

  const loadFile = (file) => {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) return setError('Format non supporté (JPG, PNG, GIF, WebP, AVIF)');
    if (file.size > 10 * 1024 * 1024) return setError('Image trop grande (10 Mo max)');
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
  };

  const onCropped = async (base64, contentType) => {
    setBusy(true);
    setError(null);
    try {
      const r = await profileApi.uploadAvatar(base64, contentType);
      setUser(r.user);
      setType('upload');
      setCropSrc(null);
      flashSaved();
    } catch (e) { setError(e.message); setCropSrc(null); }
    finally { setBusy(false); }
  };

  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const save = async () => {
    setError(null);
    if (type === 'url' && !url.trim()) return setError("Entre le lien d'une image");
    setBusy(true);
    try {
      const r = await profileApi.update({
        display_name: name,
        // « photo » sans photo téléversée = on garde la lettre
        avatar_type: type === 'upload' && !user.avatar_url ? 'letter' : type,
        avatar_color: bg,
        avatar_text_color: fg,
        avatar_url_external: url,
      });
      setUser(r.user);
      flashSaved();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (cropSrc) {
    return (
      <div className="panel">
        <h2 className="panel-title">Recadrer ta photo</h2>
        <ImageCropper imageSrc={cropSrc} onCrop={onCropped} onCancel={() => setCropSrc(null)} />
        {error && <div className="error-box">{error}</div>}
      </div>
    );
  }

  return (
    <div className="panel profile">
      <h2 className="panel-title">👤 Mon profil</h2>
      {!hasAccess && (
        <div className="notice">
          Ton compte est prêt. Un administrateur doit t'ouvrir l'accès aux autres écrans — en attendant, personnalise ton profil !
        </div>
      )}

      <div className="profile-preview">
        <Avatar user={preview} size={96} />
        <div className="profile-names">
          <strong>{name || user.username}</strong>
          <span className="muted small">@{user.username}</span>
        </div>
      </div>

      <div className="field">
        <label>Nom affiché</label>
        <input className="input" maxLength={32} value={name} placeholder={user.username}
          onChange={e => setName(e.target.value)} />
      </div>

      <div className="field">
        <label>Avatar</label>
        <div className="auth-tabs">
          {[['letter', 'Lettre'], ['upload', 'Photo'], ['url', 'Lien']].map(([k, label]) => (
            <button key={k} type="button" className={type === k ? 'on' : ''} onClick={() => setType(k)}>{label}</button>
          ))}
        </div>
      </div>

      {type === 'letter' && (
        <div className="profile-colors">
          <div className="field">
            <label>Couleur de fond</label>
            <div className="swatches">
              {BG_PRESETS.map(c => (
                <button key={c} type="button" className={`swatch${bg.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }}
                  onClick={() => setBg(c)} aria-label={c} />
              ))}
              <input type="color" className="swatch-input" value={bg} onChange={e => setBg(e.target.value)} aria-label="Couleur personnalisée" />
            </div>
          </div>
          <div className="field">
            <label>Couleur de la lettre</label>
            <div className="swatches">
              {TEXT_PRESETS.map(c => (
                <button key={c} type="button" className={`swatch${fg.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }}
                  onClick={() => setFg(c)} aria-label={c} />
              ))}
              <input type="color" className="swatch-input" value={fg} onChange={e => setFg(e.target.value)} aria-label="Couleur personnalisée" />
            </div>
          </div>
        </div>
      )}

      {type === 'upload' && (
        <div className={`dropzone${drag ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); loadFile(e.dataTransfer.files?.[0]); }}>
          <div className="dropzone-icon">🖼️</div>
          <div><strong>Choisis une photo</strong> ou glisse-la ici</div>
          <div className="muted small">Tu pourras la recadrer · 10 Mo max</div>
          <input ref={fileRef} type="file" accept={ALLOWED.join(',')} hidden
            onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {type === 'url' && (
        <div className="field">
          <label>Lien de l'image</label>
          <input className="input" value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)} />
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      <div className="modal-actions">
        {saved && <span className="saved">✓ Enregistré</span>}
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
