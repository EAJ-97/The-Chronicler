const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const svg = fs.readFileSync('public/icon.svg', 'utf-8');
[[512,'pwa-512x512'],[192,'pwa-192x192'],[180,'apple-touch-icon-180x180']].forEach(([s,n]) => {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s } });
  fs.writeFileSync('public/' + n + '.png', r.render().asPng());
});
fs.copyFileSync('public/pwa-512x512.png', 'public/maskable-icon-512x512.png');
console.log('PWA icons generated');
