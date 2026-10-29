import {rankPlaces} from './domain.js';
import {markerLayout} from './marker-layout.js';
self.onmessage=async({data:{id,op,args}})=>{try{
 let result;
 if(op==='decode'){
  const data=args[0];
  if(data?.encoding==='gzip-base64'){
   const bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));
   result=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }else result=data;
 }else if(op==='rank'){result=rankPlaces(...args).map(p=>({index:p.__index,score:p.score,distance:p.distance,evidence:p.evidence,reason:p.reason,ownExperience:p.ownExperience}));}
 else if(op==='layout')result=markerLayout(...args);
 else if(op==='filter'){const [places,b]=args;result=places.filter(p=>p.lon>=b.west&&p.lon<=b.east&&p.lat>=b.south&&p.lat<=b.north);}
 if(!['decode','layout','filter','rank'].includes(op))throw new Error('지원하지 않는 데이터 작업');
 self.postMessage({id,result});
}catch(error){self.postMessage({id,error:error.message||'데이터 처리 실패'});}};

