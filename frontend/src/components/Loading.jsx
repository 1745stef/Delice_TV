import { useEffect, useState } from 'react';

// Indicateur de chargement. Au bout de quelques secondes, on explique que le serveur
// gratuit (Render) est peut-être en train de se réveiller.
export default function Loading({ label = 'Chargement…', wakeAfterMs = 5000 }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), wakeAfterMs);
    return () => clearTimeout(t);
  }, [wakeAfterMs]);
  return (
    <div className="loading">
      <div className="loading-gem">🔮</div>
      <div>{label}</div>
      {slow && <div className="loading-hint">Le serveur se réveille, cela peut prendre jusqu'à une minute…</div>}
    </div>
  );
}
