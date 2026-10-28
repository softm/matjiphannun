import { hasValidUrl } from './domain.js?v=20261029c';

const text = value => String(value || '').trim();
const identity = value => text(value).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
export function mergeEnrichment(place, record) {
  const address = value => text(value).toLowerCase().replace(/[^0-9a-z가-힣-]/g, '');
  if (!record || record.id !== place.id || identity(record.name) !== identity(place.name) || address(record.address) !== address(place.address)) return place;
  const facts = (record.facts || []).filter(f => text(f.key) && text(f.label) && text(f.value) && hasValidUrl(f.sourceUrl));
  const points = (record.points || []).filter(p => text(p.text) && facts.some(f => f.key === p.evidence?.key && f.value === p.evidence?.value && f.sourceUrl === p.evidence?.sourceUrl));
  const value = key => facts.find(f => f.key === key)?.value || '';
  const images = [...(place.images || []), ...(record.images || [])].filter(i => hasValidUrl(i.url) && ['Type1', 'Type3'].includes(i.license));
  return {
    ...place,
    hours: value('hours') || place.hours,
    phone: value('phone') || place.phone,
    website: hasValidUrl(value('website')) ? value('website') : place.website,
    menu: [...new Set([value('signatureMenu'), value('menu')].filter(Boolean))].map(name => ({name})),
    images: [...new Map(images.map(i => [i.url, i])).values()],
    enrichment: { ...record, facts, points },
  };
}

export function visitPoints(place, limit = 8) {
  return (place.enrichment?.points || []).filter(p => ['fact','caution','conflict'].includes(p.kind)).slice(0, limit);
}

export function neighbourhoodPoints(places) {
  const enriched = places.filter(p => p.enrichment?.facts?.length);
  const withKey = key => enriched.filter(p => p.enrichment.facts.some(f => f.key === key)).length;
  return { total: places.length, enriched: enriched.length, menus: withKey('signatureMenu'), hours: withKey('hours'), parking: withKey('parking'), caution: enriched.filter(p => visitPoints(p).some(v => v.kind === 'caution' || v.kind === 'conflict')).length };
}
