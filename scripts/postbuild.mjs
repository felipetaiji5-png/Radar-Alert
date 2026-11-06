import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'www');
const manifestPath = path.join(out, '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const shell = new Set(['/', '/index.html', '/manifest.webmanifest', '/icon.svg']);
for (const entry of Object.values(manifest)) {
  if (entry.file) shell.add('/' + entry.file.replace(/^\//, ''));
  for (const css of entry.css || []) shell.add('/' + css.replace(/^\//, ''));
  for (const asset of entry.assets || []) shell.add('/' + asset.replace(/^\//, ''));
}
for (const name of ['manifest.webmanifest', 'icon.svg', 'ATTRIBUTION.txt', 'ATTRIBUTION-OSM.txt']) {
  try { await cp(path.join(root, name), path.join(out, name)); } catch { /* arquivo opcional */ }
}
const sw = `const CACHE = 'radar-alert-shell-v0171';\nconst SHELL = ${JSON.stringify([...shell])};\nself.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });\nself.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('radar-alert-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });\nself.addEventListener('fetch', event => { const request = event.request; const url = new URL(request.url); if (request.method !== 'GET' || url.origin !== self.location.origin) return; event.respondWith(fetch(request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; }).catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('/index.html') : Response.error())))); });\n`;
await writeFile(path.join(out, 'sw.js'), sw);
console.log(`Build web concluído. ${shell.size} recursos do app-shell incluídos no precache.`);
