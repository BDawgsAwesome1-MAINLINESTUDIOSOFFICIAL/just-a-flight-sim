const VERSION = "jafs-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./fleet.html",
  "./css/app.css",
  "./js/app.js",
  "./js/audio.js",
  "./js/encode-worker.js",
  "./js/fleet-data.js",
  "./js/fleet-page.js",
  "./js/pa.js",
  "./js/paths.js",
  "./js/takes.js",
  "./data/fleet.json",
  "./audio/chime.mp3",
  "./audio/fart.mp3",
  "./audio/hangup.mp3",
  "./audio/cabin-jet.mp3",
  "./audio/cabin-prop.mp3",
  "./audio/cabin-piston.mp3",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        if (res.ok && new URL(event.request.url).origin === self.location.origin) {
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
