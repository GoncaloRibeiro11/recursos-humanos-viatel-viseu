export class OopJournal {
  constructor({storage,userId,projectId,rpc,onStatus=()=>{},locks=globalThis.navigator?.locks}){
    Object.assign(this,{storage,rpc,onStatus,locks,userId});this.prefix=`rh-oop-pending-v1:${projectId}:${userId}:`;this.items=new Map();this.confirmed=new Set();this.running=null;this.stopped=false;this.durable=true;this.timer=null;this.read();
  }
  read(){try{for(const key of [...this.items.keys()])if(!this.storage.getItem(key) && !this.items.get(key).volatile)this.items.delete(key);for(let i=0;i<this.storage.length;i++){const key=this.storage.key(i);if(key?.startsWith(this.prefix) && !this.items.has(key) && !this.confirmed.has(key)){const item=JSON.parse(this.storage.getItem(key));if(item && ['contact','action','void'].includes(item.kind))this.items.set(key,item);}}}catch{this.durable=false;}this.status();}
  status(){this.onStatus({count:this.items.size,writing:!!this.running,durable:this.durable,issues:[...this.items.values()].filter(i=>i.error),items:[...this.items.values()]});}
  enqueue(kind,args,id=crypto.randomUUID()){
    if(this.stopped)throw new Error('Sessão encerrada.');const item={kind,args:{...structuredClone(args),p_request_id:id,p_actor_id:this.userId},id,at:Date.now(),error:''},key=this.prefix+id;this.items.set(key,item);
    try{this.storage.setItem(key,JSON.stringify(item));}catch{this.durable=false;item.volatile=true;}this.status();return id;
  }
  discard(id){const key=this.prefix+id;if(this.running)throw new Error('Aguarda o fim da gravação.');this.storage.removeItem(key);this.items.delete(key);this.status();}
  async flush(){
    if(this.running || this.stopped)return this.running;
    const send=async()=>{this.read();for(const [key,item] of [...this.items].sort((a,b)=>a[1].at-b[1].at)){
      if(this.stopped)break;
      try{await this.rpc({contact:'rh_oop_save_contact',action:'rh_oop_save_action',void:'rh_oop_void_contact'}[item.kind],item.args);this.confirmed.add(key);try{this.storage.removeItem(key);}catch{this.durable=false;}this.items.delete(key);}
      catch(error){item.error=error.message || 'Aguarda ligação ao servidor.';try{this.storage.setItem(key,JSON.stringify(item));}catch{this.durable=false;}break;}
    }};
    this.running=(this.locks?this.locks.request(this.prefix,send):send()).finally(()=>{this.running=null;this.status();if(this.items.size && !this.stopped)this.timer=setTimeout(()=>this.flush(),15000);});this.status();return this.running;
  }
  stop(){this.stopped=true;clearTimeout(this.timer);}
}
