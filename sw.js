const CACHE = "dvs-utility-v5.0";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./assets/tools/01_Loudness.png",
  "./assets/tools/02_Calcolatrice_Timecode.png",
  "./assets/tools/04_DCP_Audio.png",
  "./assets/tools/05_DCP_Video.png",
  "./assets/tools/06_DCP_Puntate.png",
  "./assets/tools/Scheda_Tecnica.png",
  "./theme.css",
  "./app-intro.css",
  "./app-intro.js",
  "./folders.css",
  "./folders.js",
  "./app.js",
  "./app-update.js",
  "./app-zoom.js",
  "./assets/tools/Strumenti.png",
  "./assets/tools/Informazioni.png",
  "./config.js",
  "./parser.js",
  "./loudness.js",
  "./technical.js",
  "./history.js",
  "./manifest.webmanifest",
  "./assets/logos/digital-video-full.png",
  "./assets/icons/favicon.ico",
  "./assets/icons/dvs-utility-32.png",
  "./assets/icons/dvs-utility-64.png",
  "./assets/icons/dvs-utility-180.png",
  "./assets/icons/dvs-utility-192.png",
  "./assets/icons/dvs-utility-512.png",
  "./assets/icons/dvs-utility-1024.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(ASSETS.map((url) => new Request(url, {cache: "reload"})));
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dvs-utility-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(new Request(event.request, {cache: "no-cache"})).then((response) => {
      if (!response.ok) throw new Error("Offline");
      return response;
    }).catch(() => caches.match(new URL("./index.html", self.registration.scope).href)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
