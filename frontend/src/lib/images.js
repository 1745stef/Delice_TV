// Prépare une image choisie par l'utilisateur avant l'envoi : au-delà de 3 Mo, on la réduit
// (2000 px max, JPEG) pour un envoi rapide et un chargement léger sur téléphone.
const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Lecture du fichier impossible'));
  r.readAsDataURL(file);
});
const loadImg = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Image illisible"));
  img.src = src;
});

export async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Le fichier doit être une image');
  const dataUrl = await readAsDataURL(file);
  if (file.size <= 3 * 1024 * 1024) return { base64: dataUrl.split(',')[1], contentType: file.type };

  const img = await loadImg(dataUrl);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { base64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], contentType: 'image/jpeg' };
}
