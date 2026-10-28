import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEnrichment, visitPoints, neighbourhoodPoints } from '../lib/enrichment.js';
const place={id:'tour:1',name:'검증식당',address:'서울 중구 길 1',images:[],hours:''};
const fact={key:'parking',label:'주차',value:'주차 불가',sourceUrl:'https://example.com/store',sourceName:'업소 웹',checkedAt:'2026-10-28'};
const record={...place,facts:[fact],points:[{label:'주차',text:'주차 불가',kind:'caution',evidence:fact}],images:[{url:'https://example.com/unlicensed.jpg'}]};
test('a source record for a different floor or branch is not merged',()=>{
 assert.equal(mergeEnrichment(place,{...record,address:'서울 중구 길 1 2층'}),place);
 assert.equal(mergeEnrichment(place,{...record,id:'tour:other'}),place);
});
test('negative visitor information and evidence survive but unlicensed images do not',()=>{
 const result=mergeEnrichment(place,record);
 assert.equal(visitPoints(result)[0].text,'주차 불가');assert.equal(result.images.length,0);
 assert.deepEqual(neighbourhoodPoints([result,place]),{total:2,enriched:1,menus:0,hours:0,parking:1,caution:1});
});
test('a point whose evidence is absent from facts is never displayed',()=>{
 const result=mergeEnrichment(place,{...record,points:[{...record.points[0],evidence:{...fact,value:'무료 주차'}}]});
 assert.equal(visitPoints(result).length,0);
});
