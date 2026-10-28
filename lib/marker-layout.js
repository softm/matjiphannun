// Bound HTML marker count while representing every visible restaurant.
export function markerLayout(places,bounds,selectedId,budget=240){
 const visible=places.filter(p=>p.lat>=bounds.south&&p.lat<=bounds.north&&p.lon>=bounds.west&&p.lon<=bounds.east);
 if(visible.length<=budget)return visible;
 const cols=20,rows=12,cells=new Map(),selected=visible.find(p=>p.id===selectedId);
 for(const p of visible){
  if(p===selected)continue;
  const x=Math.min(cols-1,Math.floor((p.lon-bounds.west)/(bounds.east-bounds.west||1)*cols));
  const y=Math.min(rows-1,Math.floor((p.lat-bounds.south)/(bounds.north-bounds.south||1)*rows));
  const key=x+':'+y;const cell=cells.get(key)||{id:'cluster:'+key,count:0,lat:0,lon:0,first:p};
  cell.count++;cell.lat+=p.lat;cell.lon+=p.lon;cells.set(key,cell);
 }
 return [...cells.values()].map(c=>c.count===1?c.first:{id:c.id,count:c.count,lat:c.lat/c.count,lon:c.lon/c.count,name:c.count.toLocaleString('ko-KR')+'곳',amenity:'cluster'}).concat(selected?[selected]:[]);
}
