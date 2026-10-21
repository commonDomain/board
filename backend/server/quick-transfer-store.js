import crypto from 'node:crypto';

export const TRANSFER_MAX=100*1024*1024;
export const TRANSFER_TTL=15*60*1000;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const digest=value=>crypto.createHash('sha256').update(String(value||'').slice(0,128)).digest();
const matches=(value,hash)=>crypto.timingSafeEqual(digest(value),hash);
function opaque(value,maximum) {
  return typeof value==='string'&&value.length>=40&&value.length<=maximum&&/^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// Bounded encrypted signaling only: no file bytes, filesystem, database or execution.
export class QuickTransferStore {
  constructor({now=()=>Date.now()}={}) {this.rooms=new Map();this.now=now;}
  async create(owner,offer) {
    await this.sweep();
    if(!opaque(offer,32768))throw fail('配对连接信息无效');
    if(this.rooms.size>=64||[...this.rooms.values()].filter(r=>r.owner===owner).length>=2)throw fail('快传连接暂满，请撤销已有链接后重试',429);
    const id=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(32).toString('base64url'),ownerToken=crypto.randomBytes(32).toString('base64url');
    const room={id,owner,offer,answer:null,claimHash:null,tokenHash:digest(token),ownerHash:digest(ownerToken),expiresAt:this.now()+TRANSFER_TTL};
    this.rooms.set(id,room);return {room,token,ownerToken};
  }
  get(id,token) {
    const room=this.rooms.get(id);
    if(!room||room.expiresAt<=this.now()||!matches(token,room.tokenHash))throw fail('配对二维码无效或已过期',404);
    return room;
  }
  answer(room,claim,answer) {
    if(typeof claim!=='string'||!/^[a-f0-9]{32}$/.test(claim)||!opaque(answer,32768))throw fail('连接信息无效');
    if(room.answer){
      if(matches(claim,room.claimHash)&&room.answer===answer)return;
      throw fail('此链接已由另一接收端连接，请让发送端生成新链接',409);
    }
    room.claimHash=digest(claim);room.answer=answer;
  }
  isOwner(room,owner,ownerToken) {return room.owner===owner&&matches(ownerToken,room.ownerHash);}
  isReceiver(room,claim) {return !!room.claimHash&&matches(claim,room.claimHash);}
  async remove(room) {this.rooms.delete(room.id);}
  async sweep() {for(const room of this.rooms.values())if(room.expiresAt<=this.now())this.rooms.delete(room.id);}
}
