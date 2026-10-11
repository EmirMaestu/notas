// Genera todos los íconos de la app a partir de assets/icon/*.svg. Correr: node scripts/generate-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const full = readFileSync('assets/icon/icon-full.svg', 'utf8');
const simple = readFileSync('assets/icon/icon-simple.svg', 'utf8');

// Fondo a sangre (sin esquinas redondeadas) con el contenido achicado: para íconos que el sistema recorta
// con su propia máscara (Android "maskable", iOS). `scale` deja el dibujo dentro de la zona segura.
function fullBleed(svg, scale) {
  const inner = svg
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace('</svg>', '')
    .replace(/<rect width="512" height="512" rx="114" fill="url\(#brillo\)"\/>/, '');
  const pad = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner.match(/<defs>[\s\S]*<\/defs>/)[0]}
  <rect width="512" height="512" fill="url(#fondo)"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})">${inner.replace(/<defs>[\s\S]*<\/defs>/, '').replace(/<rect[^>]*\/>/g, '')}</g>
</svg>`;
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();

// ICO con imágenes PNG embebidas (formato admitido por todos los navegadores actuales).
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

mkdirSync('public/icons', { recursive: true });

writeFileSync('src/app/icon.svg', simple);
writeFileSync('src/app/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(simple, size) })))));
writeFileSync('src/app/apple-icon.png', await png(fullBleed(full, 0.84), 180));
writeFileSync('public/icons/icon-192.png', await png(full, 192));
writeFileSync('public/icons/icon-512.png', await png(full, 512));
writeFileSync('public/icons/maskable-512.png', await png(fullBleed(full, 0.76), 512));

console.log('íconos generados');
