import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import BingoAdmin from '../bingo/BingoAdmin';
import BingoPlayer from '../bingo/BingoPlayer';

// Selon ses modules : admin (prépare tout), ou joueur (streamer : dévoile les gages / spectateur : regarde).
export default function BingoPage() {
  const { can } = useAuth();
  const canAdmin  = can('bingo.admin');
  const canStream = can('bingo.stream');
  const [preview, setPreview] = useState(false);   // un admin regarde la vue joueur

  if (canAdmin && !preview) return <BingoAdmin onPreview={() => setPreview(true)} />;

  return (
    <div className="bingo-page">
      {canAdmin && (
        <div className="bingo-modebar">
          <span className="muted small">
            Aperçu joueur{canStream ? '' : ' — lecture seule : seul le streamer peut dévoiler un gage'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPreview(false)}>🪄 Vue admin</button>
        </div>
      )}
      <BingoPlayer readOnly={!canStream} />
    </div>
  );
}
