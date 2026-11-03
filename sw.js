// T·IQ+7 — service worker : jeu complet hors connexion (sauf le mode en ligne).
// Changer VERSION à chaque nouvelle version du jeu (page, icônes). Changer MEDIA seulement si les .mp3 changent.
const VERSION = "tiq7-v4";
const MEDIA = "tiq7-media-v1";
const abs = u => new URL(u, self.registration.scope).href;
const CORE = ["manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png", "favicon.ico"].map(abs);
const AUDIO = ["pion.mp3", "musique.mp3", "ambiance1.mp3", "ambiance2.mp3", "ambiance3.mp3"].map(abs);
const FONT_CSS = [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Nunito:wght@400;700;900&display=swap",
  "https://fonts.googleapis.com/css2?family=Lilita+One&display=swap"
];

// Installation rapide : seulement la page et les petits fichiers. Les sons et polices sont téléchargés ensuite en arrière-plan.
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.add(abs("./"));
    await Promise.allSettled(CORE.map(u => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== MEDIA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const inflight = new Set();
async function cacheOne(u) {
  if (inflight.has(u)) return;
  inflight.add(u);
  try {
    const m = await caches.open(MEDIA);
    if (await m.match(u, { ignoreVary: true })) return;
    const r = await fetch(u);
    if (r.ok && r.status === 200) await m.put(u, r);
  } catch (_) {} finally { inflight.delete(u); }
}

async function warmFonts() {
  const c = await caches.open(MEDIA);
  for (const u of FONT_CSS) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      await c.put(u, res.clone());
      const css = await res.text();
      const files = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]);
      for (const f of files) {
        try { if (!(await c.match(f))) { const r = await fetch(f); if (r.ok) await c.put(f, r); } } catch (_) {}
      }
    } catch (_) {}
  }
}

async function warm() {
  await warmFonts();
  for (const u of AUDIO) await cacheOne(u);
  const m = await caches.open(MEDIA);
  let missing = 0;
  for (const u of AUDIO) if (!(await m.match(u, { ignoreVary: true }))) missing++;
  const fonts = (await m.keys()).filter(k => k.url.indexOf("fonts.gstatic.com") > -1).length;
  return { missing, fonts };
}

let warming = null;
self.addEventListener("message", e => {
  if (e.data !== "warm") return;
  const src = e.source;
  if (!warming) warming = warm().finally(() => { warming = null; });
  e.waitUntil(warming.then(r => { if (src) src.postMessage({ warm: true, missing: r.missing, fonts: r.fonts }); }));
});

// Les sons doivent répondre aux demandes partielles (Range), sinon Safari refuse de les lire.
async function serveAudio(e) {
  const req = e.request;
  const m = await caches.open(MEDIA);
  const res = await m.match(req.url, { ignoreVary: true });
  if (!res) { e.waitUntil(cacheOne(req.url)); return fetch(req); }
  const rg = req.headers.get("range");
  if (!rg) return res;
  const ct = res.headers.get("Content-Type") || "audio/mpeg";
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const mt = /bytes=(\d*)-(\d*)/.exec(rg);
  if (!mt) return new Response(buf, { status: 200, headers: { "Content-Type": ct, "Content-Length": String(size) } });
  let s, en;
  if (mt[1] === "") { s = Math.max(0, size - Number(mt[2])); en = size - 1; }
  else { s = Number(mt[1]); en = mt[2] === "" ? size - 1 : Math.min(Number(mt[2]), size - 1); }
  if (s >= size || s > en) return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(buf.slice(s, en + 1), { status: 206, headers: {
    "Content-Type": ct, "Content-Length": String(en - s + 1),
    "Content-Range": "bytes " + s + "-" + en + "/" + size, "Accept-Ranges": "bytes" } });
}

self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;

  // Polices Google : cache d'abord, mise à jour en arrière-plan
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(MEDIA).then(async c => {
      const hit = await c.match(r);
      const net = fetch(r).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Autres sites (Supabase, bibliothèque en ligne…) : on ne touche pas
  if (u.origin !== location.origin) return;

  // Sons
  if (/\.mp3$/i.test(u.pathname)) { e.respondWith(serveAudio(e)); return; }

  // Page du jeu : réseau d'abord (dernière version), cache si pas de réseau ou réseau trop lent (4 s)
  if (r.mode === "navigate") {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const net = fetch(r).then(res => { if (res.ok) c.put(abs("./"), res.clone()); return res; });
      net.catch(() => {});
      try {
        return await Promise.race([net, new Promise((_, ko) => setTimeout(ko, 4000))]);
      } catch (_) {
        return (await c.match(abs("./"))) || net;
      }
    })());
    return;
  }

  // Icônes, manifeste et autres fichiers du jeu : cache d'abord
  e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
