import sharp from 'sharp';
// Web delivery copies only: preserve the original images and their alpha channels.
const characters = {beth:'30201_贝丝.png',lance:'30100_兰斯.png',chris:'30100_克丽丝.png',ian:'30201_伊恩.png'};
for (const [key, file] of Object.entries(characters)) {
  await sharp(file).resize({ height: 1500, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100 }).toFile(`public/assets/characters/${key}.webp`);
}
await sharp('assets-source/palace.png').webp({ quality: 88 }).toFile('public/assets/environment/palace.webp');
await sharp('assets-source/yellow-eight-point-star.png').resize(100, 100, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/assets/gems/yellow.png');
console.log('WebP delivery assets prepared; source PNGs preserved.');
