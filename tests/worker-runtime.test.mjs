import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {gzipSync} from 'node:zlib';
const entry=new URL('../lib/data-worker.js',import.meta.url).href;
test('real worker decodes compressed data, filters viewport and clusters without losing count',async()=>{
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:r=>parentPort.postMessage(r)};import(${JSON.stringify(entry)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
 try{
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
  let id=0;const call=(op,args)=>new Promise((resolve,reject)=>{const n=++id;const handler=data=>{if(data.id!==n)return;worker.off('message',handler);data.error?reject(Error(data.error)):resolve(data.result)};worker.on('message',handler);worker.postMessage({id:n,op,args});});
  const places=Array.from({length:20000},(_,i)=>({id:String(i),name:'식당'+i,lat:37+(i%100)/100,lon:126+(i%200)/200}));
  const payload={encoding:'gzip-base64',data:gzipSync(JSON.stringify({places})).toString('base64')};
  const decoded=await call('decode',[payload]);assert.equal(decoded.places.length,20000);
  const bounds={west:126,east:126.5,south:37,north:37.5};const filtered=await call('filter',[decoded.places,bounds]);
  assert.ok(filtered.length>0&&filtered.length<20000);assert.ok(filtered.every(p=>p.lon<=126.5&&p.lat<=37.5));
  const markers=await call('layout',[filtered,bounds,null]);assert.ok(markers.length<=240);assert.equal(markers.reduce((n,m)=>n+(m.count||1),0),filtered.length);
  await assert.rejects(call('decode',[{encoding:'gzip-base64',data:'invalid'}]));
  assert.equal((await call('filter',[[places[0]],bounds])).length,1);
 }finally{await worker.terminate();}
});
