import { distanceMeters } from './domain.js?v=20261029c';
import { readStore, writeStore } from './storage.js?v=20261029c';
import { loadNaverMaps } from './naver-map.js?v=20261029c';
import { mergeEnrichment } from './enrichment.js?v=20261029c';
const dataRoot = new URL(globalThis.location?.hostname?.endsWith('androidplatform.net') ? 'https://softm.github.io/matjiphannun/data/' : '../data/', import.meta.url);
let manifestPromise;
let manifestExpires = 0;
let enrichmentPromise, enrichmentExpires = 0;
async function getJSON(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error('식당 데이터 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const result = await response.json();
  if (result?.encoding !== 'gzip-base64') return result;
  if (typeof DecompressionStream === 'undefined') throw new Error('압축 식당 데이터를 읽으려면 Chrome 또는 Android System WebView를 업데이트해 주세요.');
  const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}
export function getManifest(signal) {
  if (!manifestPromise || Date.now() > manifestExpires) { manifestExpires = Date.now() + 300000; manifestPromise = getJSON(new URL('manifest.json', dataRoot), AbortSignal.timeout(15000)).catch(err => { manifestPromise=null; throw err; }); }
  return manifestPromise;
}
async function enrichPlaces(places, shards, signal) {
  try {
    if (!enrichmentPromise || Date.now() > enrichmentExpires) {
      enrichmentExpires = Date.now() + 300000;
      enrichmentPromise = getJSON(new URL('enrichment/manifest.json', dataRoot), AbortSignal.timeout(10000)).catch(error => { enrichmentPromise = null; throw error; });
    }
    const manifest = await enrichmentPromise;
    const cells = new Set(shards.map(s => s.path.split('/').at(-1).replace(/\.json$/, '')));
    const relevant = (manifest.shards || []).filter(s => cells.has(s.cell));
    const records = {};
    for (let i = 0; i < relevant.length; i += 4) {
      const results = await Promise.all(relevant.slice(i, i + 4).map(s => getJSON(new URL(`enrichment/${s.path}?v=${s.sha256}`, dataRoot), signal)));
      for (const result of results) Object.assign(records, result.records);
    }
    return { places: places.map(p => mergeEnrichment(p, records[p.id])), enrichmentAvailable: true };
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return { places, enrichmentAvailable: false };
  }
}
function intersects(bounds, lat, lon, radius) {
  const dy = radius / 110500, dx = radius / (111320 * Math.max(.1,Math.cos(lat*Math.PI/180)));
  return bounds[0] <= lon+dx && bounds[2] >= lon-dx && bounds[1] <= lat+dy && bounds[3] >= lat-dy;
}
export async function fetchRestaurants(lat, lon, radius, signal) {
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`;
  const cached = readStore('publicPoiCache');
  try {
    const manifest = await getManifest(signal);
    const shards = manifest.shards.filter(s=>intersects(s.bounds,lat,lon,radius));
    const batches = [];
    // Bound simultaneous downloads and retain AbortSignal for rapid location changes.
    for (let i=0;i<shards.length;i+=4) batches.push(...await Promise.all(shards.slice(i,i+4).map(s=>getJSON(new URL(s.path,dataRoot),signal))));
    const basePlaces = batches.flatMap(b=>b.places).filter(p=>distanceMeters(lat,lon,p.lat,p.lon)<=radius);
    const { places, enrichmentAvailable } = await enrichPlaces(basePlaces, shards, signal);
    const timestamp = new Date(manifest.generatedAt).valueOf();
    writeStore('publicPoiCache',{key,places,timestamp,manifestVersion:manifest.version});
    return {places,fetchedAt:timestamp,cached:false,stale:Date.now()-timestamp>7*86400_000,manifest,enrichmentAvailable};
  } catch(err) {
    if(err.name==='AbortError')throw err;
    if(cached.key===key&&Array.isArray(cached.places))return {places:cached.places,fetchedAt:cached.timestamp,cached:true,stale:true};
    throw err;
  }
}
const regionCache=new Map();
export async function fetchViewport(bounds,signal,onProgress) {
  const manifest=await getManifest(signal);
  const shards=manifest.shards.filter(s=>s.bounds[0]<=bounds.east&&s.bounds[2]>=bounds.west&&s.bounds[1]<=bounds.north&&s.bounds[3]>=bounds.south);
  const center={lat:(bounds.south+bounds.north)/2,lon:(bounds.west+bounds.east)/2};
  shards.sort((a,b)=>distanceMeters(center.lat,center.lon,(a.bounds[1]+a.bounds[3])/2,(a.bounds[0]+a.bounds[2])/2)-distanceMeters(center.lat,center.lon,(b.bounds[1]+b.bounds[3])/2,(b.bounds[0]+b.bounds[2])/2));
  const places=[],errors=[];let cursor=0,done=0,last=0;
  const timestamp=new Date(manifest.generatedAt).valueOf();
  const progress=()=>{if(signal?.aborted)return;const time=Date.now();if(time-last<250&&done<shards.length)return;last=time;onProgress?.({places:places.slice(),fetchedAt:timestamp,done,total:shards.length});};
  async function worker(){
    while(cursor<shards.length){
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const s=shards[cursor++],key=manifest.version+':'+s.path;
      try{
        let result=regionCache.get(key);
        if(!result){result=await getJSON(new URL(s.path,dataRoot),signal);regionCache.set(key,result);if(regionCache.size>512)regionCache.delete(regionCache.keys().next().value);}
        for(const p of result.places)if(p.lon>=bounds.west&&p.lon<=bounds.east&&p.lat>=bounds.south&&p.lat<=bounds.north)places.push(p);
      }catch(error){if(signal?.aborted||error.name==='AbortError')throw error;errors.push(s.path);}
      done++;progress();
    }
  }
  await Promise.all(Array.from({length:Math.min(12,shards.length)},worker));
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(errors.length&&!places.length)throw new Error('지역 데이터 조회 실패');
  const extra=await enrichPlaces(places,shards.slice(0,12),signal);
  return {...extra,fetchedAt:timestamp,stale:errors.length>0,manifest,failedShards:errors.length};
}
function geocodeCall(method, params, signal) {
  return loadNaverMaps().then(n=>new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));
    const timer=setTimeout(()=>reject(new Error('주소 조회 시간이 초과되었습니다. 다시 검색해 주세요.')),12000);
    n.Service[method](params,(status,response)=>{
      clearTimeout(timer);
      if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));
      if(status!==n.Service.Status.OK)return reject(new Error('네이버 주소 검색을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'));
      resolve(response);
    });
  }));
}
export async function lookupLocations(query,signal) {
  const q=String(query||'').trim().slice(0,120);
  if(q.length<2)throw new Error('동네 또는 주소를 두 글자 이상 입력하세요.');
  const result=await geocodeCall('geocode',{query:q,count:5},signal);
  return (result.v2?.addresses||[]).map(r=>({lat:Number(r.y),lon:Number(r.x),name:r.roadAddress||r.jibunAddress||q})).filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon));
}
export async function reverseLocation(lat,lon,signal) {
  await loadNaverMaps();
  const result=await geocodeCall('reverseGeocode',{coords:new window.naver.maps.LatLng(lat,lon),orders:'addr,roadaddr'},signal);
  const address=result.v2?.address;
  return address?.jibunAddress||address?.roadAddress||'내 현재 위치';
}
