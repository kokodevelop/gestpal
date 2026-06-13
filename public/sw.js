// Service worker minimal — requis pour l'installabilité PWA
// L'app nécessite le serveur, pas de mise en cache offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
