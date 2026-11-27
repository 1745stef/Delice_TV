import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

// Ce que voit un inscrit qui n'est dans aucun groupe (ou dont les groupes ne montrent rien) : RIEN.
export default function EmptyPage() {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const reload = async () => { setBusy(true); await refresh(); setBusy(false); };
  return (
    <div className="empty-page">
      <div className="empty-gem">🔮</div>
      <p className="muted">Ton compte est prêt. Un administrateur doit t'ouvrir l'accès.</p>
      <button className="btn btn-ghost btn-sm" onClick={reload} disabled={busy}>{busy ? '…' : 'Actualiser'}</button>
    </div>
  );
}
