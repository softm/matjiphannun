const CACHE='matjiphannun-shell-v6-web-details-20261028';
const FILES=['./','./index.html','./styles.css?v=20261029d','./app.js?v=20261029d','./config.js?v=20261029d','./lib/naver-map.js?v=20261029d','./lib/domain.js?v=20261029d','./lib/storage.js?v=20261029d','./lib/providers.js?v=20261029d','./lib/enrichment.js?v=20261029d','./lib/marker-layout.js?v=20261029d','./lib/worker-client.js?v=20261029d','./lib/data-worker.js?v=20261029d','./assets/icon.svg','./manifest.webmanifest','./data-status.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&FILES.some(path=>new URL(path,self.registration.scope).pathname===url.pathname)){
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request)));
});
