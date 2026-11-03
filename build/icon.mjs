import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${pad?0:96}" fill="#14161c"/>
<g transform="translate(256 262) scale(${pad?0.72:0.9})">
<rect x="-150" y="-185" width="190" height="270" rx="18" fill="#5aa3e0" transform="rotate(-16)"/>
<rect x="-95" y="-170" width="190" height="270" rx="18" fill="#e0644f" transform="rotate(0)"/>
<rect x="-40" y="-155" width="190" height="270" rx="18" fill="#e0a54a" transform="rotate(16)"/>
<path d="M58 -40 l18 40 44 6 -32 30 8 44 -38 -22 -38 22 8 -44 -32 -30 44 -6z" fill="#14161c" transform="rotate(16)"/>
</g></svg>`;
const b = await chromium.launch(); const p = await b.newPage();
for (const [name, size, pad] of [['icon-192',192,false],['icon-512',512,false],['icon-maskable-512',512,true]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(pad).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await b.close();
