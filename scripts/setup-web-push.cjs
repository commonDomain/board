'use strict';
// Append once; never print or replace an existing VAPID private key.
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const webpush=require('web-push');
const file=path.resolve(__dirname,'../.env');
const source=fs.readFileSync(file,'utf8'),env=parseEnv(source);
if(env.WEB_PUSH_PUBLIC_KEY||env.WEB_PUSH_PRIVATE_KEY){
  throw new Error('Existing Web Push configuration found; update it explicitly to preserve browser subscriptions.');
}
const base=new URL(env.PUBLIC_BASE_URL||'http://localhost:4000/');
const subject=process.argv[2]||(base.protocol==='https:'&&base.hostname!=='localhost'?base.origin:undefined);
if(!subject)throw new Error('Supply a contact, e.g. npm run setup:push -- mailto:admin@example.com');
const keys=webpush.generateVAPIDKeys();webpush.setVapidDetails(subject,keys.publicKey,keys.privateKey);
const clean=source.replace(/^WEB_PUSH_(?:ENABLED|SUBJECT|PUBLIC_KEY|PRIVATE_KEY)=.*\r?\n?/gm,'');
fs.writeFileSync(file,`${clean}\n# Web Push VAPID — keep this private key stable and backed up.\nWEB_PUSH_ENABLED=1\nWEB_PUSH_SUBJECT=${subject}\nWEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\n`);
console.log('Web Push configured in .env. Restart the server, then enable desktop notifications in chat.');
