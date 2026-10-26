const PREFIX = 'matjiphannun:v1:';
const defaults = {
  favorites: {}, reviews: {}, savedLocations: [], settings: { radius: 2400, context: 'balanced', category: 'all', sort: 'fit' },
};
function local() { try { return globalThis.localStorage; } catch { return null; } }
export function readStore(key) {
  try {
    const raw = local()?.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : structuredClone(defaults[key] ?? {});
  } catch { return structuredClone(defaults[key] ?? {}); }
}
export function writeStore(key, value) {
  try { local()?.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
export function exportArchive() {
  return JSON.stringify({ product: '맛집한눈', schemaVersion: 1, exportedAt: new Date().toISOString(),
    favorites: readStore('favorites'), reviews: readStore('reviews'), savedLocations: readStore('savedLocations'), settings: readStore('settings') }, null, 2);
}
export function importArchive(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.schemaVersion !== 1 || obj.product !== '맛집한눈' ||
    typeof obj.favorites !== 'object' || obj.favorites === null || Array.isArray(obj.favorites) || !Array.isArray(obj.savedLocations) || typeof obj.reviews !== 'object' || obj.reviews === null || Array.isArray(obj.reviews)) {
    throw new Error('맛집한눈 백업 파일 형식이 아닙니다.');
  }
  if (obj.savedLocations.length > 1000 || Object.keys(obj.favorites).length > 10000 || Object.keys(obj.reviews).length > 10000) {
    throw new Error('백업 파일 데이터 크기가 허용 범위를 초과했습니다.');
  }
  for (const p of obj.savedLocations) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || typeof p.name !== 'string') {
      throw new Error('저장된 위치 형식에 오류가 있습니다.');
    }
  }
  writeStore('favorites', obj.favorites);
  writeStore('reviews', obj.reviews);
  writeStore('savedLocations', obj.savedLocations);
  if (obj.settings && typeof obj.settings === 'object') writeStore('settings', obj.settings);
  return { saved: Object.keys(obj.favorites).length, records: Object.keys(obj.reviews).length };
}
