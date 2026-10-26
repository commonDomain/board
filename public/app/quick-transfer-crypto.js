// Entire encrypted frame fits below the conservative 16 KiB SCTP message limit.
export const QUICK_CHUNK=16*1024-20;
export const QUICK_MAX=100*1024*1024;
export function toBase64(value) {
  const bytes=new Uint8Array(value);let text='';
  for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
export const fromBase64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
export const toUrl64=value=>toBase64(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function quickIv(prefix,index) {
  const iv=new Uint8Array(12);iv.set(prefix);new DataView(iv.buffer).setUint32(8,index,false);return iv;
}
export function quickAad(index,size) {return new TextEncoder().encode(`muse-quick:v1:${index}:${size}`);}
export const quickKey=raw=>crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
export async function seal(key,prefix,index,size,bytes) {
  return crypto.subtle.encrypt({name:'AES-GCM',iv:quickIv(prefix,index),additionalData:quickAad(index,size)},key,bytes);
}
export async function unseal(key,prefix,index,size,bytes) {
  return crypto.subtle.decrypt({name:'AES-GCM',iv:quickIv(prefix,index),additionalData:quickAad(index,size)},key,bytes);
}
export function parseQuickLink(value,base) {
  let hash=String(value).trim();
  if(!hash.startsWith('#quick=')){
    const url=new URL(hash,base),origin=new URL(base);
    const paths=new Set([origin.pathname,new URL('quick-transfer.html',origin).pathname,new URL('index.html',origin).pathname,new URL('.',origin).pathname]);
    if(url.origin!==origin.origin||!paths.has(url.pathname)||url.username||url.password)throw new Error('请扫描本站生成的快传二维码');
    hash=url.hash;
  }
  const match=hash.match(/^#quick=([a-f0-9]{32})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{11})$/);
  if(!match)throw new Error('配对信息无效，请重新扫码');
  const [,id,token,raw,prefix]=match;
  return {id,token,raw:fromBase64(raw),prefix:fromBase64(prefix)};
}
export function safeQuickName(value) {
  let name=String(value||'接收文件').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,180).replace(/[. ]+$/,'');
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name=`_${name}`;
  return name||'接收文件';
}

export async function signalKey(raw) {
  return deriveQuickKey(raw,'muse-quick:signaling:v2');
}
async function deriveQuickKey(raw,info) {
  const key=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(0),info:new TextEncoder().encode(info)},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export const controlKey=(raw,role)=>deriveQuickKey(raw,`muse-quick:control:v3:${role}`);
export async function sealControl(key,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('muse-quick:control:v3')},key,new TextEncoder().encode(JSON.stringify(value)));
  const bytes=new Uint8Array(12+cipher.byteLength);bytes.set(iv);bytes.set(new Uint8Array(cipher),12);return toBase64(bytes);
}
export async function openControl(key,value) {
  if(typeof value!=='string'||value.length>4096)throw new Error('设备消息过大或无效');
  const bytes=fromBase64(value);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode('muse-quick:control:v3')},key,bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function sealSignal(key,role,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12)),aad=new TextEncoder().encode(`muse-quick:v2:${role}`);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(JSON.stringify(value)));
  const frame=new Uint8Array(12+encrypted.byteLength);frame.set(iv);frame.set(new Uint8Array(encrypted),12);return toBase64(frame);
}
export async function openSignal(key,role,value) {
  if(typeof value!=='string'||value.length>32768)throw new Error('连接信息无效');
  const frame=fromBase64(value);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:frame.slice(0,12),additionalData:new TextEncoder().encode(`muse-quick:v2:${role}`)},key,frame.slice(12));
  const description=JSON.parse(new TextDecoder().decode(bytes));
  if(description.type!==role||typeof description.sdp!=='string'||description.sdp.length>24000)throw new Error('连接信息校验失败');
  return description;
}
