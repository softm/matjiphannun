import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, normalizeOSM, cuisineLabel, scorePlace, rankPlaces, escapeHTML, hasValidUrl, prettyDistance } from '../lib/domain.js';
const loc = { lat:37.5, lon:127.0 };
const restaurant = { id:'node/1', name:'사실', lat:37.5005, lon:127.0005, amenity:'restaurant', category:'한식', tags:{cuisine:'korean',opening_hours:'Mo-Fr 09:00-18:00'}, phone:'', website:'', hours:'' };
test('distance metric 0 & approximate 1km', () => {
  assert.equal(distanceMeters(37,127,37,127),0);
  assert.ok(distanceMeters(37,127,37.009,127) > 990);
  assert.equal(prettyDistance(1200),'1.2km');
});
test('OSM normalize strips unnamed records and bad coordinates', () => {
  assert.equal(normalizeOSM({type:'node',id:3,lat:37,lon:127,tags:{amenity:'restaurant'}}),null);
  assert.equal(normalizeOSM({type:'node',id:3,lat:999,lon:127,tags:{amenity:'restaurant',name:'A'}}),null);
  assert.equal(normalizeOSM({type:'way',id:3,center:{lat:37,lon:127},tags:{amenity:'restaurant',name:'김밥집'}}).id,'way/3');
  assert.equal(cuisineLabel({cuisine:'korean;japanese'}),'한식 · 일식');
});
test('context fit is not a fabricated taste rating', () => {
  const p = scorePlace(restaurant, loc, 'balanced', {});
  assert.ok(p.score > 0 && p.score < 100);
  assert.ok(p.distance > 0);
  assert.equal(p.ownExperience,null);
});
test('rank by context and filter by radius', () => {
  const distant={...restaurant,id:'node/3',lat:38};
  const nearby={...restaurant,id:'node/2',amenity:'fast_food'};
  const r=rankPlaces([restaurant,nearby,distant],loc,{context:'quick',radius:2400});
  assert.equal(r.length,2);
  assert.equal(r[0].id,'node/2');
  assert.equal(rankPlaces([restaurant],loc,{search:'xyz'}).length,0);
});
test('external links and untrusted text sanitized', () => {
  assert.equal(hasValidUrl('javascript:alert(1)'),false);
  assert.equal(hasValidUrl('https://example.com'),true);
  assert.ok(escapeHTML('<script>"').includes('&lt;script&gt;'));
});
