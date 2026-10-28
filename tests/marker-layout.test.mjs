import test from 'node:test';import assert from 'node:assert/strict';import {markerLayout} from '../lib/marker-layout.js';
test('100000 restaurants remain represented by at most 241 markers including selection',()=>{
 const p=Array.from({length:100000},(_,i)=>({id:String(i),lat:37+(i%1000)/1000,lon:126+Math.floor(i/1000)/100}));
 const r=markerLayout(p,{south:37,north:38,west:126,east:127},'9');
 assert.ok(r.length<=241);assert.equal(r.reduce((n,p)=>n+(p.count||1),0),p.length);assert.ok(r.some(p=>p.id==='9'&&!p.count));
});
