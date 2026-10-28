import test from 'node:test';
import assert from 'node:assert/strict';
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
