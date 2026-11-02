import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const d='/home/claude/src/crm-tracker/data/new/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:1600}});
p.on('pageerror',e=>console.log('ERR',e.message.slice(0,200)));
await p.goto('file:///mnt/user-data/uploads/CRM_Tracker_Dashboard_1.html#/import'); await p.waitForTimeout(5000);
const inputs=await p.$$('input[type=file]');
await inputs[0].setInputFiles([d+'Order_Punched_Report_01-04-2026_to_29-10-20261793253974.xls',d+'Complaint_dump_-_datasense_-_YTD.xls']);
await p.waitForTimeout(20000);
for(let i=0;i<8;i++){const btn=await p.$('main button:has-text("Next")'); if(!btn)break; await btn.click(); await p.waitForTimeout(5000);}
await (await p.$('main button:has-text("Apply import")')).click();
await p.waitForTimeout(25000);
console.log((await p.innerText('main')).replace(/\n+/g,' | ').slice(0,700));
const out=await p.evaluate(async()=>{
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('hero-crm-tracker');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  const get=(s,k)=>new Promise(res=>{const r=db.transaction(s).objectStore(s)[k==null?'getAll':'get'](k);r.onsuccess=()=>res(r.result)});
  const metas=await get('meta');
  const res=[];
  for(const m of metas){ if(/^(Order_Punched|Complaint_dump)/.test(m.fileName)){ const r=await get('records',m.id); res.push({meta:m,records:r.records,issues:r.issues,raw:[]});} }
  return {all:metas.map(m=>[m.source,m.fileName,m.periodStart,m.periodEnd,m.validCount]),res};
});
console.log(out.all.map(x=>x.join(' | ')).join('\n'));
fs.writeFileSync('/home/claude/new_ds_payloads.json',JSON.stringify(out.res));
console.log('saved',out.res.map(r=>[r.meta.source,r.records.length,r.issues.length]));
await b.close();
