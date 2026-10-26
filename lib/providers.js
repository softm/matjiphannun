import { normalizeOSM } from './domain.js';
import { readStore, writeStore } from './storage.js';
const API = 'https://overpass-api.de/api/interpreter';
const GEO_URL = 'https://nominatim.openstreetmap.org';
let lastGeoRequest = 0;
// 프로토타입용 공개 API. 서비스 트래픽 증가 시 인허가/장소 데이터 자체 저장소 및 계약형 API로 전환.
export async function fetchRestaurants(lat, lon, radius, signal) {
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`;
  const cache = readStore('poiCache');
  const cached = cache?.key === key ? cache : null;
  if (cached && Date.now() - cached.timestamp < 6 * 3600_000) return { places: cached.places, fetchedAt: cached.timestamp, cached: true, stale: false };
  // 동시에 지도 이동할 때 자동 수집하지 않으며, 사용자가 지정한 한 지역만 수집.
  const q = `[out:json][timeout:25];nwr["amenity"~"^(restaurant|cafe|fast_food|food_court)$"](around:${Math.min(5000, Math.max(500, radius))},${lat.toFixed(6)},${lon.toFixed(6)});out center 600;`;
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: q }), signal });
    if (!res.ok) throw new Error(`장소 API 응답 ${res.status}`);
    const body = await res.json();
    const places = (Array.isArray(body.elements) ? body.elements : []).map(normalizeOSM).filter(Boolean);
    // OSM은 노드/웨이가 같은 음식점을 중복 기록할 수 있어 동일명/근접 장소를 묶음.
    const seen = new Set();
    const deduped = places.filter(p => {
      const tile = `${p.name.toLocaleLowerCase('ko-KR')}:${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
      if (seen.has(tile)) return false;
      seen.add(tile); return true;
    });
    const timestamp = Date.now();
    writeStore('poiCache', { key, places: deduped, timestamp });
    return { places: deduped, fetchedAt: timestamp, cached: false, stale: false };
  } catch (err) {
    if (cached) return { places: cached.places, fetchedAt: cached.timestamp, cached: true, stale: true };
    throw err;
  }
}
async function geocodeRequest(path, params, signal) {
  const now = Date.now();
  if (now - lastGeoRequest < 1100) await new Promise(resolve => setTimeout(resolve, 1100 - (now - lastGeoRequest)));
  lastGeoRequest = Date.now();
  const url = `${GEO_URL}${path}?${new URLSearchParams({ format: 'jsonv2', 'accept-language': 'ko', ...params })}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`주소 조회 실패 ${res.status}`);
  return res.json();
}
export async function lookupLocations(query, signal) {
  const q = String(query || '').trim().slice(0, 120);
  if (q.length < 2) throw new Error('동네 또는 주소를 두 글자 이상 입력하세요.');
  return (await geocodeRequest('/search', { q, addressdetails: '1', limit: '5' }, signal))
    .map(r => ({ lat: Number(r.lat), lon: Number(r.lon), name: r.display_name || q }));
}
export async function reverseLocation(lat, lon, signal) {
  const r = await geocodeRequest('/reverse', { lat: String(lat), lon: String(lon), zoom: '16', addressdetails: '1' }, signal);
  const a = r.address || {};
  const name = [a.city || a.province || a.state, a.borough || a.city_district || a.county, a.suburb || a.quarter || a.neighbourhood || a.town].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(' ');
  return name || String(r.display_name || '내 현재 위치').split(',').slice(0, 2).join(' ');
}
