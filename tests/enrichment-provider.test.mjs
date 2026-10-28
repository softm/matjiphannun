import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRestaurants, fetchViewport } from '../lib/providers.js';
const store=new Map();globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
const place={id:'tour:2',name:'웹식당',address:'서울 중구 길 2',lat:37.5,lon:127,hours:''};
const fact={key:'hours',label:'영업시간',value:'11:00~20:00',sourceUrl:'https://example.com/store'};
let fail=false;const calls=[];
globalThis.fetch=async url=>{
 const path=String(url);calls.push(path);
 if(path.includes('enrichment/manifest.json'))return{ok:true,json:async()=>({shards:[{cell:'5080-1500',path:'regions/5080-1500.json',sha256:'version'}]})};
 if(path.includes('enrichment/regions/')){if(fail)throw Error('unavailable');return{ok:true,json:async()=>({records:{[place.id]:{...place,facts:[fact],points:[]}}})};}
 if(path.endsWith('manifest.json'))return{ok:true,json:async()=>({version:'1',generatedAt:new Date().toISOString(),shards:[{path:'regions/1/5080-1500.json',bounds:[126,37,128,38]}]})};
 return{ok:true,json:async()=>({places:[place]})};
};
test('nearby public records receive only their matching regional web facts',async()=>{
 const result=await fetchRestaurants(37.5,127,2400,new AbortController().signal);
 assert.equal(result.places[0].hours,'11:00~20:00');assert.equal(result.enrichmentAvailable,true);
 assert.ok(calls.some(url=>url.includes('enrichment/regions/5080-1500.json')));
});
test('an unavailable web enrichment shard preserves usable base restaurant data',async()=>{
 fail=true;const result=await fetchRestaurants(37.5,127,2400,new AbortController().signal);
 assert.equal(result.places[0].name,'웹식당');assert.equal(result.places[0].hours,'');assert.equal(result.enrichmentAvailable,false);
});

test('viewport query includes the whole rectangle independently of search radius',async()=>{
 fail=false;const signal=new AbortController().signal;
 const small=await fetchViewport({west:126,south:37.6,east:128,north:38},signal);assert.equal(small.places.length,0);
 const large=await fetchViewport({west:126,south:37,east:128,north:38},signal);assert.equal(large.places[0].id,place.id);
 const ac=new AbortController();ac.abort();await assert.rejects(fetchViewport({west:126,south:37,east:128,north:38},ac.signal),{name:'AbortError'});
});
