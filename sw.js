// T·IQ+7 — service worker. Changer VERSION à chaque mise en ligne d'une nouvelle version.
const VERSION = "tiq7-v2";
const FILES = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  // On ne touche pas : autres sites (Supabase, polices, CDN), requêtes non-GET, audio (requêtes partielles)
  if (r.method !== "GET" || u.origin !== location.origin || r.headers.has("range") || /\.mp3$/i.test(u.pathname)) return;
  // Page du jeu : réseau d'abord (toujours la dernière version), cache si hors ligne
  if (r.mode === "navigate") {
    e.respondWith(
      fetch(r).then(res => { const cp = res.clone(); caches.open(VERSION).then(c => c.put("./", cp)); return res; })
        .catch(() => caches.match("./"))
    );
    return;
  }
  // Icônes et manifeste : cache d'abord
  e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
