const CACHE='matjiphannun-shell-v6-web-details-20261028';
const FILES=['./','./index.html','./styles.css?v=20261029a','./app.js?v=20261029a','./config.js?v=20261029a','./lib/naver-map.js?v=20261029a','./lib/domain.js?v=20261029a','./lib/storage.js?v=20261029a','./lib/providers.js?v=20261029a','./lib/enrichment.js?v=20261029a','./assets/icon.svg','./manifest.webmanifest','./data-status.html'];
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
