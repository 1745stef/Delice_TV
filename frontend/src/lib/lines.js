// Lignes du Bingo qui portent un gage : chaque ligne, chaque colonne, la diagonale
// haut-gauche → bas-droite (grille carrée seulement), et le « toupet suprême » (carte pleine : toutes les cases).
// Même logique que le backend.
export function bingoLines(cols, rows) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    lines.push({ key: `row-${r}`, positions: Array.from({ length: cols }, (_, c) => r * cols + c) });
  }
  for (let c = 0; c < cols; c++) {
    lines.push({ key: `col-${c}`, positions: Array.from({ length: rows }, (_, r) => r * cols + c) });
  }
  if (cols === rows) {
    lines.push({ key: 'diag', positions: Array.from({ length: rows }, (_, i) => i * cols + i) });
  }
  lines.push({ key: 'full', positions: Array.from({ length: cols * rows }, (_, i) => i) });
  return lines;
}

export function lineLabel(key) {
  if (key === 'diag') return 'Diagonale';
  if (key === 'full') return 'Toupet suprême';
  const [type, n] = key.split('-');
  return `${type === 'row' ? 'Ligne' : 'Colonne'} ${Number(n) + 1}`;
}
