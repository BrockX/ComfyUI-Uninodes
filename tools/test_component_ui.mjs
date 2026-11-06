// Run with node. Exercises selection and asynchronous discovery without a backend.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/direct_sampler.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const COMPONENT_FIELDS='),source.indexOf('function stopGestures'));
let pending;
const context=vm.createContext({JSON,Map,Array,Error,structuredClone,
 api:{fetchApi:()=>new Promise(resolve=>{pending=resolve;})},
 val:(node,key)=>node[key],parse:()=>({}),write:(node,cfg)=>{node._dsConfig=cfg;},
 optionalSockets:()=>{},render:()=>{},
 select:(value,items)=>({value,options:items.map(item=>({value:item.value,style:{}})),style:{},addEventListener(){}}),
});
vm.runInContext(helpers+'\nglobalThis.helpers={clipChoice,setClipChoice,refreshComponents,componentSelect};',context);
const {clipChoice,setClipChoice,refreshComponents,componentSelect}=context.helpers;
const recommended=JSON.stringify(['single','krea2',['detected.safetensors']]);
const options={recommended_clip:recommended,recommended_vae:'compatible.vae',saved:{},clips:[{value:recommended,label:'detected',compatible:true}],vaes:[]};
const node=()=>({_dsOptions:{},checkpoint:'model',profile_mode:'Custom',_dsConfig:{clip_source:'Internal',vae_name:'Internal'}});
const finish=payload=>pending({ok:true,json:async()=>payload});
let n=node(),request=refreshComponents(n);finish(options);await request;
assert.equal(n._dsConfig.encoder_1,'detected.safetensors');
assert.equal(n._dsConfig.vae_name,'compatible.vae');
assert.equal(clipChoice(n._dsConfig),recommended);
const saved={clip_source:'Manual',encoder_loader:'dual',encoder_type:'flux',encoder_1:'missing-a',encoder_2:'missing-b',vae_name:'missing-vae'};
n=node();request=refreshComponents(n);finish({...options,saved});await request;
assert.equal(n._dsConfig.encoder_1,'missing-a');
assert.equal(n._dsConfig.encoder_2,'missing-b');
assert.equal(n._dsConfig.vae_name,'missing-vae');
n=node();request=refreshComponents(n);setClipChoice(n._dsConfig,JSON.stringify(['single','krea2',['user-edit']]));n._dsConfig.vae_name='user-vae';finish(options);await request;
assert.equal(n._dsConfig.encoder_1,'user-edit');
assert.equal(n._dsConfig.vae_name,'user-vae');
n=node();request=refreshComponents(n);n.checkpoint='different-model';finish(options);await request;
assert.equal(n._dsConfig.clip_source,'Internal');
const control=componentSelect(recommended,options.clips,'CLIP');
assert.equal(control.style.color,'#72e2a3');
assert.equal(control.options.find(option=>option.value===recommended).style.color,'#72e2a3');
console.log('PASS: automatic picks, saved missing choices, encoder bundles, user edits, stale responses, and green highlighting');
