import test from 'node:test';
import assert from 'node:assert/strict';
import { readStore, writeStore, importArchive, exportArchive } from '../lib/storage.js';
const contents=new Map();
globalThis.localStorage={ getItem:key=>contents.get(key)||null,setItem:(key,val)=>contents.set(key,val) };
test('archive backup includes local data and restores',()=>{
  writeStore('favorites',{'node/1':{name:'나의 식당'}});
  writeStore('reviews',{'node/1':{stars:5,note:'재방문'}});
  writeStore('savedLocations',[{lat:37.5,lon:127,name:'서울'}]);
  const json=exportArchive();
  writeStore('favorites',{});
  const result=importArchive(json);
  assert.equal(result.saved,1);
  assert.equal(readStore('reviews')['node/1'].stars,5);
  assert.equal(readStore('favorites')['node/1'].name,'나의 식당');
});
test('rejects malformed and unsafe archives',()=>{
  assert.throws(()=>importArchive('{"schemaVersion":1,"product":"맛집한눈","favorites":null,"reviews":{},"savedLocations":[]}'));
  assert.throws(()=>importArchive('{"schemaVersion":1,"product":"맛집한눈","favorites":{},"reviews":{},"savedLocations":[{"lat":999,"lon":127,"name":"x"}]}'));
});
