export const DEFAULT_PLACE = Object.freeze({ lat: 37.5665, lon: 126.9780, name: '서울시청 · 기본 탐색 위치', isCurrent: false });
export const CATEGORIES = Object.freeze({
  all: '전체', restaurant: '식당', cafe: '카페', fast_food: '간편식', food_court: '푸드코트',
});
export const CONTEXTS = Object.freeze({
  balanced: '전체 추천', solo: '혼밥', quick: '빨리 한 끼', meeting: '여유로운 식사', coffee: '카페',
});
const KOREAN_CUISINES = { korean: '한식', chinese: '중식', japanese: '일식', italian: '이탈리아', pizza: '피자', burger: '버거', sandwich: '샌드위치', coffee_shop: '커피', vietnamese: '베트남', thai: '태국', indian: '인도', american: '미국식', seafood: '해산물', asian: '아시아', mexican: '멕시칸', french: '프랑스', chicken: '치킨', barbecue: '바비큐', noodles: '면요리', regional: '지역음식' };
export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = n => (n * Math.PI / 180);
  const phi1 = rad(lat1), phi2 = rad(lat2);
  const dPhi = rad(lat2 - lat1), dLam = rad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function prettyDistance(n) {
  if (!Number.isFinite(n)) return '거리 미확인';
  return n < 1000 ? `${Math.round(n / 10) * 10}m` : `${(n / 1000).toFixed(1)}km`;
}
export function cuisineLabel(tags = {}) {
  const cs = (tags.cuisine || '').split(';').map(x => x.trim()).filter(Boolean);
  const cuisine = cs.map(x => KOREAN_CUISINES[x] || x.replace(/_/g, ' ')).join(' · ');
  if (cuisine) return cuisine;
  return ({ restaurant: '음식점', cafe: '카페', fast_food: '간편식', food_court: '푸드코트' })[tags.amenity] || '음식점';
}
export function normalizeOSM(element) {
  if (!element || !['node', 'way', 'relation'].includes(element.type) || !Number.isInteger(element.id)) return null;
  const lat = Number(element.lat ?? element.center?.lat), lon = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const tags = element.tags || {};
  const name = String(tags['name:ko'] || tags.name || '').trim();
  if (!name) return null; // 이름 없는 POI는 맛집 선택에 도움이 되지 않음
  const amenity = String(tags.amenity || '');
  if (!['restaurant', 'cafe', 'fast_food', 'food_court'].includes(amenity)) return null;
  return {
    id: `${element.type}/${element.id}`, type: element.type, osmId: element.id,
    name, lat, lon, amenity, tags,
    category: cuisineLabel(tags),
    address: [tags['addr:city'], tags['addr:district'], tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || '',
    phone: String(tags['contact:phone'] || tags.phone || '').trim(),
    website: String(tags['contact:website'] || tags.website || '').trim(),
    hours: String(tags.opening_hours || '').trim(),
  };
}
export function hasValidUrl(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}
export function completeness(place) {
  const tags = place.tags || {};
  const indicators = [place.category, place.address, place.phone, place.website, place.hours, place.hygiene];
  return indicators.filter(Boolean).length;
}
export function scorePlace(place, origin, context = 'balanced', feedback = {}) {
  const distance = distanceMeters(origin.lat, origin.lon, place.lat, place.lon);
  const category = place.amenity;
  const experience = feedback[place.id]?.stars || 0;
  // 객관적인 맛/평점 점수가 아님: 주변 거리 + 명시적 태그 + 내 기록 기반의 상대적인 '상황 적합도'.
  const distancePts = Math.round(47 * Math.exp(-distance / 1400));
  let matchPts = 15;
  let reason = '현재 위치와의 접근성';
  if (context === 'solo') { matchPts = category === 'fast_food' ? 32 : category === 'restaurant' ? 21 : 8; reason = '간편식 업종 우선 · 실제 혼밥 편의는 확인 필요'; }
  if (context === 'quick') { matchPts = category === 'fast_food' ? 37 : category === 'cafe' ? 24 : 13; reason = '간편식 중심의 업종 적합도'; }
  if (context === 'meeting') { matchPts = category === 'restaurant' ? 34 : category === 'food_court' ? 15 : 8; reason = '식사형 업종 적합도'; }
  if (context === 'coffee') { matchPts = category === 'cafe' ? 37 : 5; reason = '카페 업종 일치'; }
  const knownPts = Math.min(12, completeness(place) * 2);
  const ownPts = experience > 0 ? Math.round((experience - 3) * 4) : 0;
  const score = clamp(distancePts + matchPts + knownPts + ownPts, 0, 99);
  return { score, distance, evidence: completeness(place), reason, ownExperience: experience || null };
}
export function rankPlaces(places, origin, { context = 'balanced', category = 'all', radius = 2400, search = '', sort = 'fit', favorites = {}, reviews = {} } = {}) {
  const q = search.trim().toLocaleLowerCase('ko-KR');
  return places
    .filter(p => category === 'all' || p.amenity === category)
    .map(p => ({ ...p, ...scorePlace(p, origin, context, reviews) }))
    .filter(p => p.distance <= radius && (!q || `${p.name} ${p.category} ${p.address}`.toLocaleLowerCase('ko-KR').includes(q)))
    .sort((a, b) => sort === 'distance' ? a.distance - b.distance : sort === 'saved' ? Number(Boolean(favorites[b.id])) - Number(Boolean(favorites[a.id])) || b.score - a.score : b.score - a.score || a.distance - b.distance);
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export function formatDateTime(iso) {
  if (!iso) return '시각 미확인';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return '시각 미확인';
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
