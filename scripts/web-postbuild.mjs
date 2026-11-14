// After `expo export --platform web`: make dist/index.html an installable web app (PWA) for iPhone and Android.
//   node scripts/web-postbuild.mjs dist
// Adds the manifest, the iPhone « Add to Home Screen » tags (own icon, standalone, status bar), theme colour and notch-safe viewport.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const file = join(dir, 'index.html');
let html = readFileSync(file, 'utf8');

const tags = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
  '<link rel="manifest" href="manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="DualCast" />',
  '<meta name="theme-color" content="#0A0B10" />',
  '<meta name="format-detection" content="telephone=no" />',
  '<style>html,body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}</style>',
].join('\n    ');

html = html.replace(/<meta name="viewport"[^>]*>\s*/i, '');
html = html.replace(/<title>[^<]*<\/title>/i, '<title>DualCast Translate</title>');
if (!/<title>/i.test(html)) html = html.replace('</head>', '<title>DualCast Translate</title></head>');
html = html.replace('</head>', `    ${tags}\n  </head>`);
if (!/<html[^>]*lang=/i.test(html)) html = html.replace(/<html/i, '<html lang="fr"');
writeFileSync(file, html);
console.log(`web-postbuild: ${file} is now installable (manifest, iPhone tags)`);
