import { distanceMeters } from './domain.js?v=20261027c';
import { readStore, writeStore } from './storage.js?v=20261027c';
import { loadNaverMaps } from './naver-map.js?v=20261027c';
const dataRoot = new URL(globalThis.location?.hostname?.endsWith('androidplatform.net') ? 'https://softm.github.io/matjiphannun/data/' : '../data/', import.meta.url);
let manifestPromise;
let manifestExpires = 0;
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
    const places = batches.flatMap(b=>b.places).filter(p=>distanceMeters(lat,lon,p.lat,p.lon)<=radius);
    const timestamp = new Date(manifest.generatedAt).valueOf();
    writeStore('publicPoiCache',{key,places,timestamp,manifestVersion:manifest.version});
    return {places,fetchedAt:timestamp,cached:false,stale:Date.now()-timestamp>7*86400_000,manifest};
  } catch(err) {
    if(err.name==='AbortError')throw err;
    if(cached.key===key&&Array.isArray(cached.places))return {places:cached.places,fetchedAt:cached.timestamp,cached:true,stale:true};
    throw err;
  }
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
