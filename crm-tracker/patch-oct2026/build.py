import re, json, gzip, base64, subprocess, sys, os
ES='/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild/bin/esbuild'
P='/home/claude/patch'
# 1. compile module
r=subprocess.run([ES,P+'/src/index.ts','--bundle','--format=iife','--global-name=__LPmod','--target=es2020','--jsx=transform','--charset=utf8','--outfile='+P+'/dist/mod.js'],capture_output=True,text=True)
if r.returncode: print(r.stderr); sys.exit(1)
mod=open(P+'/dist/mod.js',encoding='utf8').read()
assert '</script' not in mod.lower()
s=open('/home/claude/orig.html',encoding='utf-8',errors='ignore').read()

# 2. snapshot: swap DataSense orders + complaints for the April-October files
snap=json.load(open('/home/claude/snapshot.json'))
new=json.load(open('/home/claude/new_ds_payloads.json'))
keep=[p for p in snap if p['meta']['source'] not in ('ds_orders','ds_complaints','issue_tracker')]
# Issue tracker: Bizom issues from the new Bizom_Hero_Tracker file; the 14 DataSense issues of the previous tracker are kept exactly as they were
iss=json.load(open('/home/claude/new_issue_payload.json'))[0]
oldiss=[p for p in snap if p['meta']['source']=='issue_tracker'][0]
dsiss=[dict(r,key='ds-'+r['key']) for r in oldiss['records'] if r['platform']=='Datasense']
assert len(dsiss)==14
iss['records']=iss['records']+dsiss
iss['meta']['rawCount']=iss['meta']['validCount']=len(iss['records'])
iss['meta']['fileName']='Bizom_Hero_Tracker__6_.xlsx (Bizom) + DataSense issues kept from Issue_Tracker.xlsx'
iss['meta']['extra']['dataSenseIssuesKept']=len(dsiss)
json.dump(iss,open('/home/claude/merged_issue_payload.json','w'))
payloads=keep+new+[iss]
LABEL='MIS files as supplied, packaged 29 Oct 2026 (DataSense Apr-Oct + Bizom tracker update)'
b64=base64.b64encode(gzip.compress(json.dumps(payloads,separators=(',',':')).encode(),9)).decode()
m=re.search(r'const Bh=\{info:\{label:"[^"]*"\},b64:"[A-Za-z0-9+/=]+"\};',s); assert m
s=s.replace(m.group(0),'const Bh={info:{label:%s},b64:"%s"};'%(json.dumps(LABEL),b64),1)

# usage report data (kept outside the dataset store: it has its own page)
if os.path.exists(P+'/dist/usage.b64'):
    UB=open(P+'/dist/usage.b64').read().strip()
else: UB=''

# 3. seeding: a newer embedded snapshot replaces the DataSense order + complaint datasets once
old_seed='async function O$(){if(Bh&&!await nS("snapshotSeededAt",null)){if((await pq()).length>0){await Km("snapshotSeededAt","existing-data");return}await C$()}}'
assert old_seed in s
new_seed=('async function O$(){if(!Bh)return;const v=Bh.info.label;if(await nS("snapshotVersion",null)===v)return;'
 'if(!await nS("snapshotSeededAt",null)){if((await pq()).length>0){await Km("snapshotSeededAt","existing-data");await Km("snapshotVersion",v);return}await C$();await Km("snapshotVersion",v);return}'
 'const S=["ds_orders","ds_complaints","issue_tracker"];for(const m of await pq())S.includes(m.source)&&await mq(m.id);'
 'for(const r of await qj())S.includes(r.meta.source)&&await ZN(r);await Km("snapshotVersion",v)}')
s=s.replace(old_seed,new_seed,1)
# first open also records the version
s=s.replace('async function C$(){const e=await qj();for(const r of e)await ZN(r);return await Km("snapshotSeededAt",new Date().toISOString()),','async function C$(){const e=await qj();for(const r of e)await ZN(r);return await Km("snapshotSeededAt",new Date().toISOString()),await Km("snapshotVersion",Bh.info.label),',1)

# 4. inject module before the router
ASK=os.environ.get('ASK_API_URL','/api/ask')
bridge='const __ASK_API=%s;const __B=()=>({le,P,hn,kt,hs,ur,Pi,J1e,zs,Mr,gs,Po,qo,qh,_l,Ln,ji,ko});const __UREP_B64="%s";'%(json.dumps(ASK),UB)
anchor='function qI({to:e}){'
assert s.count(anchor)==1
s=s.replace(anchor,bridge+mod+'\n'+anchor,1)
# 5. routes
old='P.jsx(Kn,{index:!0,element:P.jsx(kye,{})})'; assert old in s
s=s.replace(old,'P.jsx(Kn,{index:!0,element:P.jsx(__LPmod.LandingPage,{})})',1)
if 'UsagePage' in mod:
    old='P.jsx(Kn,{path:"datasense/employees",element:P.jsx(Pye,{})})'; assert old in s
    s=s.replace(old,'P.jsx(Kn,{path:"datasense/employees",element:P.jsx(__LPmod.UsagePage,{})})',1)
if 'BizomVsDataSensePage' in mod:
    old='P.jsx(Kn,{path:"compare/bizom-vs-sfa",element:P.jsx(Nye,{})})'; assert old in s
    s=s.replace(old,'P.jsx(Kn,{path:"compare/bizom-vs-sfa",element:P.jsx(__LPmod.BizomVsDataSensePage,{})})',1)
    assert s.count('label:"Bizom SFA vs Dealer SFA Usage"')==1
    s=s.replace('label:"Bizom SFA vs Dealer SFA Usage"','label:"Bizom SFA vs DataSense SFA Usage"',1)
# nav label
assert s.count('label:"Employee Activity"')==1
s=s.replace('label:"Employee Activity"','label:"Usage Report"',1)

# Overall Summary: no profitability signals, no Next steps
old='qt=Ge?[...Ge.takeaways,...Ge.risks]:[]'; assert s.count(old)==1
s=s.replace(old,'qt=Ge?[...Ge.takeaways,...Ge.risks].filter(e=>e.id!=="profit"&&e.id!=="r-profit"):[]',1)
old='Ge&&Ge.actions.length>0&&P.jsxs("section",{"aria-label":"Recommended actions",children:[P.jsx(sa,{children:"Next steps"}),P.jsx(Wbe,{items:Ge.actions,onGo:st})]}),'; assert s.count(old)==1
s=s.replace(old,'',1)
old='interval:e.length>5?"preserveStartEnd":0'; assert s.count(old)==1
s=s.replace(old,'interval:e.length>8?"preserveStartEnd":0',1)
# AI assistant: route questions through the tool-calling path, offline rules as the fallback
old='window.setTimeout(()=>{let N;try{N={id:M,from:"bot",answer:cye(K,w.current)}}catch(A){'; assert s.count(old)==1
s=s.replace(old,'window.setTimeout(async()=>{let N;try{let __a=null;try{__a=await __LPmod.askAI(K,w.current)}catch(_e){__a=null}N={id:M,from:"bot",answer:__a||cye(K,w.current)}}catch(A){',1)
old='Answers from the data in this browser. Rule-based, not generative AI; nothing leaves your computer.'; assert s.count(old)==1
s=s.replace(old,'Answers only from the dashboard data. AI reads out figures the dashboard calculates (only small summaries are sent); if the AI is unavailable the offline rules answer.',1)
# 6. css
css=open(P+'/src/lp.css',encoding='utf8').read()
last=s.rfind('</head>')
s=s[:last]+'<style id="lp-css">'+css+'</style>'+s[last:]
open(P+'/dist/CRM_Tracker_Dashboard.html','w',encoding='utf-8').write(s)
print('built',len(s)/1e6,'MB')
