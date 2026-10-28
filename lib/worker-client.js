let worker,sequence=0;const pending=new Map();
export function workerTask(op,args){
 if(typeof Worker==='undefined')return null;
 try{
  if(!worker){worker=new Worker(new URL('./data-worker.js?v=20261029d',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);Object.hasOwn(data,'error')?task.reject(Error(data.error)):task.resolve(data.result);};
   worker.onerror=()=>{worker.terminate();worker=null;for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('데이터 처리 연결 실패'));}pending.clear();};
  }
  return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('데이터 처리 시간 초과'));},30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,op,args});});
 }catch{return null;}
}
