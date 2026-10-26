import test from 'node:test';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { fetchRestaurants } from '../lib/providers.js';
const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
const places=[{id:'sbiz:near',lat:37.5,lon:127,name:'식당'},{id:'tour:far',lat:38.5,lon:127,name:'멀리'}];
const calls=[];globalThis.fetch=async (url,{signal}={})=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');calls.push(String(url));return {ok:true,json:async()=>String(url).endsWith('manifest.json')?{version:'1',generatedAt:new Date().toISOString(),shards:[{path:'regions/near.json',bounds:[126.5,37,127.5,38]},{path:'regions/far.json',bounds:[128,35,129,36]}]}:{encoding:'gzip-base64',data:gzipSync(JSON.stringify({places})).toString('base64')}};};
test('nearby lookup downloads only intersecting shards and filters straight-line distance',async()=>{
 const r=await fetchRestaurants(37.5,127,2400,new AbortController().signal);assert.deepEqual(r.places.map(p=>p.id),['sbiz:near']);assert.equal(calls.some(c=>c.endsWith('regions/far.json')),false);assert.ok(calls.some(c=>c.endsWith('regions/near.json')));
});
test('cancelled lookup never turns into a stale successful response',async()=>{
 const ac=new AbortController();ac.abort();await assert.rejects(fetchRestaurants(37.5,127,2400,ac.signal),{name:'AbortError'});
});
