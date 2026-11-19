import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RestaurantMap} from '../lib/naver-map.js';
test('map shows all loaded places inside viewport beyond first 100 and updates on idle',()=>{
 let idle;let west=126,east=128;
 const coord=(lat,lon)=>({lat:()=>lat,lng:()=>lon});
 class MapMock{getBounds(){return{getSW:()=>coord(37,west),getNE:()=>coord(38,east)}}}
 class Marker{constructor(options){this.options=options}setMap(){}}
 globalThis.window={naver:{maps:{Map:MapMock,LatLng:class{},Size:class{},Point:class{},Marker,Position:{RIGHT_BOTTOM:1,TOP_RIGHT:2},Event:{addListener:(obj,event,fn)=>{if(event==='idle')idle=fn},clearInstanceListeners(){}}}}};
 globalThis.document={getElementById:()=>({parentElement:{}})};
 globalThis.ResizeObserver=class{observe(){}};
 const map=new RestaurantMap('map',{lat:37.5,lon:127},()=>{},()=>0);
 const places=Array.from({length:150},(_,i)=>({id:String(i),name:'식당'+i,amenity:'restaurant',lat:37.5,lon:127}));
 places.push({id:'outside',name:'화면 밖',lat:37.5,lon:129});
 map.render(places,null,String);assert.equal(map.markers.length,150);
 west=128;east=130;idle();assert.equal(map.markers.length,1);assert.equal(map.markers[0].options.title,'화면 밖');
});
test('map markers use food and density symbols instead of visible numbers',async()=>{
 const coord=(lat,lon)=>({lat:()=>lat,lng:()=>lon});
 class MapMock{getBounds(){return{getSW:()=>coord(37,126),getNE:()=>coord(38,128)}}}
 class Marker{constructor(options){this.options=options}setMap(){}}
 globalThis.window={naver:{maps:{Map:MapMock,LatLng:class{},Size:class{},Point:class{},Marker,Position:{RIGHT_BOTTOM:1,TOP_RIGHT:2},Event:{addListener(){},clearInstanceListeners(){}}}}};
 globalThis.document={getElementById:()=>({parentElement:{}})};
 globalThis.ResizeObserver=class{observe(){}};
 const map=new RestaurantMap('map',{lat:37.5,lon:127},()=>{},()=>0);
 const places=Array.from({length:300},(_,i)=>({id:String(i),name:'식당'+i,amenity:'restaurant',lat:37.5,lon:127}));
 await map.render(places,null,String);
 const contents=map.markers.map(marker=>marker.options.icon.content);
 assert.ok(contents.some(content=>content.includes('restaurant-cluster is-dense')&&content.includes('🍽️')));
 assert.ok(contents.every(content=>!/>\d+</.test(content)));
});
test('mobile list sheet can fully collapse and exposes a restore button',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(html,/id="sheet-open-button"/);
 assert.match(js,/pct<12\?'hidden'/);
 assert.match(js,/Math\.max\(0,startingHeight\+startingY-e\.clientY\)/);
 assert.match(css,/data-level=hidden/);
});
test('current location always requests a fresh position',()=>{
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(js,/maximumAge:0/);
 assert.doesNotMatch(js,/maximumAge:180000/);
});
