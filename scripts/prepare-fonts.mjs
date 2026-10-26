import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = (await Promise.all(['src/main.ts', 'src/assets.ts', 'src/skills.ts', 'src/combinations.ts', 'src/online.ts', 'backend/api.ts'].map(path => readFile(path, 'utf8')))).join('');
const glyphs = [...new Set((source.match(/\p{Script=Han}/gu) ?? []).concat([..."0123456789，。·／：；！？（）「」、× /-+" ]))].sort().join('');
const url = `https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap&text=${encodeURIComponent(glyphs)}`;
const response = await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
if (!response.ok) throw new Error(`Font request: ${response.status}`);
let css = await response.text();
await mkdir('public/assets/fonts',{recursive:true});
let index = 0;
for(const match of [...css.matchAll(/url\((https:[^)]+)\)/g)]) {
  const file = `court-serif-${++index}.${css.includes("format('truetype')") ? 'ttf' : 'woff2'}`;
  const font=await fetch(match[1]); if(!font.ok) throw new Error('Font download failed');
  await writeFile(`public/assets/fonts/${file}`,Buffer.from(await font.arrayBuffer()));
  css=css.replace(match[1],`/assets/fonts/${file}`);
}
await writeFile('src/fonts.css',css);
console.log(`Bundled ${index} font subsets for local use.`);
