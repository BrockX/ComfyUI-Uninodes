/* Direct Sampler studio UI — independent custom node; legacy + Nodes 2.0. */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "CPMDirectSampler";
const DELUXE_NODE = "CPMDirectImageSamplerFinisherUltraTurboDeluxe";
const isSamplerType = type => type === NODE || type === DELUXE_NODE;
const nodes = new Map();
// Shared, disk-backed LoRA triggers. The selected file's relative path is the key;
// existing per-workflow text always wins over the global suggestion.
const sharedLoRATriggers = new Map();
const locallyEditedLoRAs = new Set();
const pendingLoRAWrites = new Map();
let loraTriggersRequest = null;
const loraKey = name => String(name||'').replaceAll('\\','/').trim().toLowerCase();
function rememberedLoRATrigger(name){return sharedLoRATriggers.get(loraKey(name))||'';}
function hydrateLoRATriggers(n){
  if(!n?._dsInstalled)return;
  const cfg=n._dsConfig||parse(n);
  let changed=false;
  for(const row of cfg.loras||[]){
    if(!row?.name||row.trigger)continue; // Never overwrite a workflow's value.
    const saved=rememberedLoRATrigger(row.name);
    if(saved){row.trigger=saved;changed=true;}
  }
  if(changed){n._dsConfig=cfg;setWidget(n,'settings_json',JSON.stringify(cfg));render(n);}
}
function loadLoRATriggerLibrary(){
  if(loraTriggersRequest)return loraTriggersRequest;
  loraTriggersRequest=(async()=>{
    const response=await api.fetchApi('/uninodes/sampler/lora-triggers');
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Could not load LoRA trigger library');
    for(const [name,trigger] of Object.entries(data.triggers||{})){
      const key=loraKey(name);
      if(!locallyEditedLoRAs.has(key)&&typeof trigger==='string')sharedLoRATriggers.set(key,trigger);
    }
    for(const node of nodes.values())hydrateLoRATriggers(node);
  })().catch(error=>{
    console.warn('[Uninodes] Global LoRA triggers unavailable:',error);
    loraTriggersRequest=null; // Allow retry on the next node instance.
  });
  return loraTriggersRequest;
}
function rememberLoRATrigger(name,trigger){
  const key=loraKey(name);
  if(!key)return Promise.resolve();
  locallyEditedLoRAs.add(key);
  if(trigger.trim())sharedLoRATriggers.set(key,trigger);
  else sharedLoRATriggers.delete(key);
  // Serialize saves for the same LoRA so rapid edits cannot arrive out of order.
  const previous=pendingLoRAWrites.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const response=await api.fetchApi('/uninodes/sampler/lora-trigger',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,trigger})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Could not save trigger words');
  });
  pendingLoRAWrites.set(key,next);
  next.finally(()=>{if(pendingLoRAWrites.get(key)===next)pendingLoRAWrites.delete(key);}).catch(()=>{});
  return next;
}
function findNode(id) {
  const key=String(id??'');
  let n=nodes.get(key);
  if(!n && app.graph?.getNodeById) {
    n=app.graph.getNodeById(Number(key));
    if(isSamplerType(n?.type)) nodes.set(key,n); else n=null;
  }
  return n;
}
const corePorts = new Set(["positive", "negative"]);
const portTypes = { positive:"STRING", negative:"STRING",latent:"LATENT",lora_stack:"DIRECT_LORA_STACK",model:"MODEL",clip:"CLIP",vae:"VAE",positive_conditioning:"CONDITIONING",negative_conditioning:"CONDITIONING",init_image:"IMAGE",mask:"MASK" };
let liveNodeId = null;
const get=(n,k)=>n.widgets?.find(w=>w.name===k);
const val=(n,k)=>get(n,k)?.value;
const graphDirty=()=>app.graph?.setDirtyCanvas(true,true);
const uuid=()=>Math.random().toString(36).slice(2);
function e(tag, cls="", text="") {const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined&&text!==null)x.textContent=String(text);return x;}
function btn(label, onClick, cls="") {const x=e('button',cls,label);x.type='button';x.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();onClick(ev);});return x;}
function field(label, control) {const w=e('label','ds-field');w.append(e('span','',label),control);return w;}
function textBox(v,type="text",step=null) {const x=e('input');x.type=type;if(type!=="checkbox")x.value=String(v??'');else x.checked=!!v;if(step!==null)x.step=step;return x;}
function select(v,values) {const x=e('select');const options=values||[];for(const item of options){const p=e('option','',typeof item==='string'?item:item.label);p.value=typeof item==='string'?item:item.value;x.append(p);}if(v!=null&&![...x.options].some(z=>z.value===String(v))){const missing=e('option','',`Missing: ${v}`);missing.value=String(v);x.prepend(missing);}x.value=String(v??'');return x;}
function stopGestures(el) {for(const evt of ['pointerdown','mousedown','dblclick'])el.addEventListener(evt,ev=>ev.stopPropagation());}
const parse=n=>{try{return JSON.parse(val(n,'settings_json')||'{}')||{};}catch{return {};}};
function setWidget(n,key,value){const w=get(n,key);if(!w)return;w.value=value;graphDirty();}
function write(n,p){setWidget(n,'settings_json',JSON.stringify(p));n._dsConfig=p;render(n);}
const MODE_SETTINGS={t2i:['steps','cfg','denoise','sampler_name','scheduler','clip_skip','width','height','resolution_category','resolution_preset','batch_size'],i2i:['steps','cfg','denoise','sampler_name','scheduler','clip_skip','width','height','resolution_category','resolution_preset','batch_size','i2i_strength','i2i_resolution_mode','internal_init_image']};
function currentMode(cfg){return cfg?.mode==='i2i'?'i2i':'t2i';}
function ensureModeSettings(cfg){cfg.t2i_settings=cfg.t2i_settings&&typeof cfg.t2i_settings==='object'?cfg.t2i_settings:{};cfg.i2i_settings=cfg.i2i_settings&&typeof cfg.i2i_settings==='object'?cfg.i2i_settings:{};for(const mode of ['t2i','i2i'])for(const key of MODE_SETTINGS[mode])if(cfg[mode+'_settings'][key]===undefined&&cfg[key]!==undefined)cfg[mode+'_settings'][key]=structuredClone(cfg[key]);if(cfg.i2i_settings.i2i_strength===undefined)cfg.i2i_settings.i2i_strength='Balanced';if(cfg.i2i_settings.i2i_resolution_mode===undefined)cfg.i2i_settings.i2i_resolution_mode='source';return cfg;}
function syncCurrentModeSettings(cfg){ensureModeSettings(cfg);const mode=currentMode(cfg), bag=cfg[mode+'_settings'];for(const key of MODE_SETTINGS[mode])bag[key]=structuredClone(cfg[key]);return cfg;}
function applyModeSettings(cfg,targetMode){ensureModeSettings(cfg);const bag=cfg[targetMode+'_settings']||{};cfg.mode=targetMode;for(const key of MODE_SETTINGS[targetMode])if(bag[key]!==undefined)cfg[key]=structuredClone(bag[key]);return cfg;}
function update(n,fn){const p=ensureModeSettings(structuredClone(n._dsConfig||parse(n)));fn(p);syncCurrentModeSettings(p);write(n,p);}
function switchMode(n,targetMode,afterApply=null){update(n,c=>{const previous=currentMode(c);const prevBag=c[previous+'_settings'];for(const key of MODE_SETTINGS[previous])prevBag[key]=structuredClone(c[key]);applyModeSettings(c,targetMode);afterApply?.(c);const nextBag=c[targetMode+'_settings'];for(const key of MODE_SETTINGS[targetMode])nextBag[key]=structuredClone(c[key]);});}
const isEnabled=(s)=>s?.enabled!==false;
function ensureCSS(){if(document.querySelector('#direct-sampler-css'))return;const s=e('style');s.id='direct-sampler-css';s.textContent=`
.ds-root,.ds-modal,.ds-root *,.ds-modal *{box-sizing:border-box}
.ds-root{width:100%;height:100%;padding:5px;color:#e8f1ff;font:12px system-ui,Segoe UI,sans-serif;min-width:0;user-select:none}
.ds-frame{display:grid;grid-template-columns:minmax(280px,var(--ds-left,39%)) 10px minmax(0,1fr);gap:9px;height:100%;background:#1e2532;border:1px solid #40526a;border-radius:12px;padding:9px;overflow:hidden}.ds-splitter{pointer-events:auto!important;touch-action:none!important;user-select:none;z-index:5;cursor:col-resize;align-self:stretch;border-radius:8px;background:linear-gradient(180deg,#2b3646,#202938);border:1px solid #465974;position:relative}.ds-splitter::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:3px;height:42px;border-radius:999px;background:#7f9fcb;box-shadow:0 0 0 1px #0004}.ds-splitter:hover,.ds-splitter.dragging{filter:brightness(1.15)}
.ds-left,.ds-right{min-width:0;display:flex;flex-direction:column;gap:10px;overflow:hidden}.ds-left{grid-column:1;grid-row:1}.ds-splitter{pointer-events:auto!important;touch-action:none!important;user-select:none;z-index:5;grid-column:2;grid-row:1}.ds-right{grid-column:3;grid-row:1}
.ds-left{padding-right:4px;overflow-y:auto;scrollbar-width:thin}.ds-right{background:#151d29;border:1px solid #41516a;border-radius:10px;padding:8px}
.ds-header{display:flex;align-items:center;gap:8px;min-height:35px}.ds-icon{height:31px;width:31px;border-radius:9px;background:#344c6b;border:1px solid #6b8bb1;display:grid;place-items:center;color:#c4dcff;font-size:18px}
.ds-title{font-weight:800;font-size:13px}.ds-caption{font-size:10px;color:#9db1cb}.ds-card{background:#293648;border:1px solid #40556f;border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:7px}
.ds-card-title{font-size:10px;font-weight:800;letter-spacing:.8px;color:#b1c6e4;text-transform:uppercase}.ds-field{display:flex;flex-direction:column;gap:4px;min-width:0}.ds-field>span{font-size:11px;color:#b8c9dc;font-weight:650}
.ds-root input,.ds-root select,.ds-root textarea,.ds-modal input,.ds-modal select,.ds-modal textarea{min-width:0;width:100%;border:1px solid #546783;background:#172235;color:#f2f6ff;border-radius:6px;padding:7px 8px;font:12px system-ui,Segoe UI,sans-serif;user-select:text;outline:none}
.ds-root input:focus,.ds-root select:focus,.ds-modal input:focus,.ds-modal select:focus{border-color:#8baeea}.ds-root option,.ds-modal option{background:#172235;color:#eaf2ff}
.ds-root input[type=checkbox],.ds-modal input[type=checkbox]{width:auto;accent-color:#81abe9}.ds-root button,.ds-modal button{border:1px solid #566d8a;border-radius:7px;background:#334761;color:#f1f6ff;font:11px system-ui,sans-serif;cursor:pointer;padding:6px 9px;white-space:nowrap}.ds-root button:hover,.ds-modal button:hover{filter:brightness(1.15)}
.ds-root button.ds-primary,.ds-modal button.ds-primary{background:#35629d;border-color:#729ce0;font-weight:800}.ds-modal .ds-profile-footer-actions{display:flex;gap:7px;flex-wrap:wrap;margin-right:auto}.ds-modal .ds-profile-footer-status{color:#c5daed;font-size:10px;min-width:0;max-width:240px;overflow-wrap:anywhere}.ds-modal .ds-profile-footer-right{display:flex;gap:7px;margin-left:auto}.ds-modal footer{flex-wrap:wrap}.ds-modal footer button:disabled{opacity:.55;cursor:wait}.ds-muted{font-size:10px;color:#a0b4cb;line-height:1.4}.ds-row{display:flex;align-items:center;gap:7px}.ds-row>*,.ds-flex{min-width:0}.ds-row.ds-between{justify-content:space-between}.ds-mode{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.ds-mode button.active,.ds-tab.active{background:#3b6398!important;border-color:#94b8ef!important}.ds-profile-actions{display:flex;gap:6px;flex-wrap:wrap}.ds-profile-actions button{flex:1 1 95px}.ds-profile-note{font-size:10px;color:#bbd2f0;line-height:1.4;overflow-wrap:anywhere}
.ds-prefix-card{gap:6px}.ds-prefix-head{display:flex;align-items:center;gap:7px;min-width:0}.ds-prefix-head .ds-card-title{margin-right:auto}.ds-prefix-toggle{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:10px;color:#c2d7ef;cursor:pointer}.ds-prefix-toggle input{margin:0;cursor:pointer}.ds-root button.ds-prefix-expand{padding:2px 6px;font-size:14px;line-height:1.3;min-width:25px}.ds-prefix-body{display:flex;flex-direction:column;gap:7px;min-width:0}.ds-prefix-field{display:flex;flex-direction:column;gap:3px;min-width:0}.ds-prefix-field>span{font-size:10px;color:#c1d4e9;font-weight:650}.ds-root textarea.ds-prefix-textarea{font-size:11px;line-height:1.4;padding:6px 7px;min-height:48px;resize:vertical;max-height:190px}.ds-prefix-hint{font-size:10px;color:#99b4cf;line-height:1.35}
.ds-2col{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ds-lora{padding:6px;border:1px solid #4b5d78;border-radius:7px;background:#1c2a3d;display:flex;flex-direction:column;gap:5px}.ds-lora-main{display:grid;grid-template-columns:16px minmax(75px,1fr) 50px 50px 23px;gap:5px;align-items:end}.ds-lora-main input[type=number]{width:100%;padding:6px 3px;text-align:center;font-size:11px}.ds-lora-main select{min-width:0;width:100%;padding:6px 3px}.ds-lora-main button{padding:5px 3px}.ds-lora-col{min-width:0;display:flex;flex-direction:column;gap:3px}.ds-lora-col>span{font-size:9px;line-height:1;color:#a9bfdc;white-space:nowrap}.ds-lora-tools{display:flex;justify-content:space-between;align-items:center;gap:5px}.ds-lora-tools details{flex:1;min-width:0}.ds-lora-tools button{padding:2px 6px}.ds-lora-tools summary{font-size:10px;cursor:pointer}.ds-seed-wrap{display:flex;align-items:center;gap:5px;min-width:0}.ds-seed-wrap>input{width:auto!important;min-width:0!important;flex:1 1 80px;min-height:32px;font-variant-numeric:tabular-nums;appearance:textfield;-moz-appearance:textfield}.ds-seed-wrap>input::-webkit-inner-spin-button,.ds-seed-wrap>input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.ds-seed-controls{display:flex;align-items:center;gap:4px;flex:none}.ds-root .ds-seed-controls .ds-chip{display:grid;place-items:center;width:28px;min-width:28px;height:28px;padding:0;border-radius:6px;font-size:13px;line-height:1}.ds-root .ds-seed-controls .ds-chip.active{background:#3b6398;border-color:#94b8ef}.ds-root .ds-seed-controls select{height:28px;width:40px;min-width:40px;max-width:40px;font-size:13px;padding:0 0 0 6px;border-radius:6px}.ds-seed-note{font-size:10px;color:#a4bddc;margin-top:4px;line-height:1.3}.ds-3col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ds-resolution-grid{display:grid;grid-template-columns:minmax(0,0.95fr) minmax(0,1.05fr);gap:10px}.ds-ratio-card{padding:8px;border:1px solid #455972;border-radius:8px;background:#1c2a3d;display:flex;flex-direction:column;gap:8px}.ds-ratio-preview{height:120px;border:1px solid #4a6079;border-radius:8px;background:#152131;display:flex;align-items:center;justify-content:center;position:relative}.ds-ratio-rect{border:1px solid #9ec2ff;background:linear-gradient(180deg,#466792 0%,#2c4b73 100%);border-radius:6px;box-shadow:inset 0 0 0 1px #ffffff14}.ds-ratio-size{position:absolute;bottom:8px;right:8px;font-size:11px;color:#cfe1ff;background:#0005;padding:3px 6px;border-radius:999px}.ds-inline-tools{display:flex;gap:7px;align-items:center}.ds-preset-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;max-height:190px;overflow:auto;padding-right:2px}.ds-preset-btn{display:flex;align-items:center;gap:8px;padding:7px 8px!important;justify-content:flex-start;text-align:left}.ds-preset-btn.active{background:#3b6398!important;border-color:#94b8ef!important}.ds-mini-rect{width:34px;height:26px;border:1px solid #88aee4;border-radius:5px;background:linear-gradient(180deg,#557aad 0%,#35537c 100%);flex:none}.ds-preset-meta{display:flex;flex-direction:column;min-width:0}.ds-preset-meta b{font-size:11px}.ds-preset-meta span{font-size:10px;color:#adc0d8}.ds-encoder-note{font-size:10px;color:#9fb2ca;margin-top:-2px}.ds-res-warning{font-size:10px;line-height:1.4;color:#f3c58c;padding:5px 6px;border:1px solid #876849;border-radius:6px;background:#422d2080}

.ds-preview-dimensions{font-size:10px;color:#c7daee;margin-left:auto;white-space:nowrap}.ds-autosave{display:flex;align-items:center;gap:4px;font-size:10px;color:#b9d0e4;white-space:nowrap}.ds-root .ds-autosave input{width:auto;min-width:0;accent-color:#90c6ff}.ds-preview-head{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:29px}.ds-preview-frame{position:relative;flex:1;min-height:180px;border:1px solid #3f526b;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#252d39 0 25%,#1c2531 0 50%) 50%/16px 16px;touch-action:none}
.ds-preview-frame img{position:absolute;width:100%;height:100%;object-fit:contain;pointer-events:none;transform-origin:center center}.ds-empty{font-size:12px;color:#a5bad7;text-align:center;padding:16px;max-width:310px;line-height:1.55}
.ds-progress{height:6px;border-radius:10px;background:#344356;overflow:hidden}.ds-progress>div{height:100%;width:0;background:#7fa9df;transition:width .13s}
.ds-gallery{display:flex;gap:7px;overflow-x:auto;min-height:52px;padding:3px;scrollbar-width:thin}.ds-thumb{border:1px solid #536b8c;border-radius:5px;overflow:hidden;min-width:42px;width:42px;height:46px;padding:0!important;background:#1a2737!important}.ds-thumb.active{outline:2px solid #8dabdb}.ds-thumb img{height:100%;width:100%;object-fit:cover}
.ds-bottom{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ds-output-folder{display:flex;align-items:center;gap:5px;flex:1 1 140px;min-width:130px}.ds-root .ds-output-folder select{min-width:100px;flex:1;width:100%}.ds-root .ds-output-folder button{padding:6px 8px}.ds-root .ds-format{width:auto;min-width:82px;max-width:96px}.ds-save-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.ds-overlay{position:fixed;inset:0;z-index:100020;background:#000b;display:flex;align-items:center;justify-content:center;padding:20px}.ds-modal{width:min(850px,95vw);height:min(700px,90vh);display:flex;flex-direction:column;background:#202b3b;color:#e8f2ff;border:1px solid #516782;border-radius:13px;overflow:hidden;font:12px system-ui,sans-serif;box-shadow:0 20px 90px #000c}
.ds-modal header,.ds-modal footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 17px;background:#273449;flex:0 0 auto}.ds-modal-body{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:0;flex:1}.ds-modal nav{border-right:1px solid #465975;display:flex;flex-direction:column;gap:7px;padding:11px;overflow-y:auto}.ds-modal nav button{text-align:left;padding:10px;background:transparent;border-color:transparent}.ds-modal article{min-height:0;overflow-y:auto;padding:17px;display:flex;flex-direction:column;gap:12px}.ds-modal footer{justify-content:flex-end;border-top:1px solid #445670}.ds-modal strong{font-size:13px}.ds-modal .ds-card{gap:11px}
.ds-root.ds-compact .ds-lora-list{max-height:138px;overflow-y:auto}.ds-top-actions{margin-left:auto;display:flex;align-items:center;gap:6px}.ds-top-actions .ds-chip{padding:6px 8px;font-size:11px;font-weight:700}.ds-top-actions .ds-chip.active{background:#3b6398;border-color:#94b8ef}.ds-mode-i2i .ds-icon{background:#295c58;border-color:#7bc6bb;color:#d9fffa}.ds-mode-i2i .ds-frame{border-color:#3f6c67}.ds-mode-i2i .ds-card{border-color:#426b67}.ds-mode-i2i .ds-primary,.ds-mode-i2i .ds-mode button.active,.ds-mode-i2i .ds-tab.active,.ds-mode-i2i .ds-top-actions .ds-chip.active,.ds-mode-i2i .ds-preset-btn.active,.ds-mode-i2i .ds-seed-controls .ds-chip.active{background:#2f746d!important;border-color:#8fd3cb!important}.ds-source-grid{display:grid;grid-template-columns:88px minmax(0,1fr);gap:10px;align-items:center}.ds-source-thumb{width:88px;height:88px;border:1px solid #4a6079;border-radius:8px;background:#152131;display:flex;align-items:center;justify-content:center;overflow:hidden}.ds-source-thumb img{width:100%;height:100%;object-fit:cover}.ds-source-thumb .ds-muted{text-align:center;padding:8px}.ds-source-meta{display:flex;flex-direction:column;gap:6px;min-width:0}.ds-source-name{font-size:12px;font-weight:700;word-break:break-word}.ds-source-details{font-size:10px;color:#a9bdd5}.ds-segment-row{display:flex;flex-wrap:wrap;gap:6px}.ds-segment-row button{flex:1 1 auto;padding:6px 8px}.ds-segment-row button.active{background:#3b6398;border-color:#94b8ef}.ds-mode-i2i .ds-segment-row button.active{background:#2f746d;border-color:#8fd3cb}.ds-res-mode{display:flex;gap:6px;flex-wrap:wrap}.ds-upload-note{font-size:10px;color:#9fb2ca;line-height:1.4}@media(max-width:660px){.ds-modal-body{grid-template-columns:160px minmax(0,1fr)}.ds-source-grid{grid-template-columns:1fr}.ds-source-thumb{width:100%;height:100px}}
`;document.head.appendChild(s);}

function previewURL(file){const q=new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'temp'});return api.apiURL(`/view?${q}`);}
function setPreview(n,src,stage='preview'){if(!n._dsView)return;n._dsView.style.display='';n._dsView.src=src;n._dsView.hidden=false;n._dsPlaceholder.hidden=true;n._dsStage.textContent=stage;}
function showFrame(n,url){if(n._dsFrameURL && n._dsFrameURL!==url)URL.revokeObjectURL(n._dsFrameURL);n._dsFrameURL=url;setPreview(n,url,'Denoising');}
function finishPreview(n,detail){const images=detail?.ds_images||detail?.images||[];if(!images.length)return;n.properties??={};n.properties.ds_preview_images=images.slice(0,12);if(n._dsFrameURL){URL.revokeObjectURL(n._dsFrameURL);n._dsFrameURL=null;}n._dsResults=images.slice(0,12);n._dsResultIndex=0;if(n._dsDimensions){const i=n._dsResults[0];n._dsDimensions.textContent=i?.width&&i?.height?`${i.width} × ${i.height}`:'';}n._dsFinalURL=previewURL(images[0]);setPreview(n,n._dsFinalURL,'Final image');n._dsProgress.style.width='100%';n._dsProgressLabel.textContent='Complete';rebuildGallery(n);}
function rebuildGallery(n){const row=n._dsGallery;if(!row)return;row.replaceChildren();for(let i=0;i<(n._dsResults||[]).length;i++){const item=n._dsResults[i];const b=btn('',()=>{n._dsResultIndex=i;n._dsFinalURL=previewURL(item);setPreview(n,n._dsFinalURL,'Final image');render(n);},'ds-thumb'+(i===n._dsResultIndex?' active':''));const im=e('img');im.addEventListener('error',()=>b.remove(),{once:true});im.src=previewURL(item);b.append(im);row.append(b);}}
async function fetchOutputFolders(n){try{const r=await api.fetchApi('/uninodes/sampler/folders');const d=await r.json();if(!r.ok)throw Error(d.error||'Folder list unavailable');n._dsOutputFolders=d.folders||[''];render(n);}catch(err){console.warn('[Direct Sampler] Output folders',err);}}
async function createOutputFolder(n){const folder=window.prompt('New folder inside ComfyUI/output (Parent/Child allowed):','Generated');if(folder===null||!folder.trim())return;try{const r=await api.fetchApi('/uninodes/sampler/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:folder.trim()})});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to create folder');n.properties??={};n.properties.ds_output_folder=folder.trim();n._dsOutputFolders=data.folders||[''];graphDirty();render(n);}catch(err){if(n._dsProgressLabel)n._dsProgressLabel.textContent=err.message;}}
async function browseOutputFolder(n){try{if(n._dsProgressLabel)n._dsProgressLabel.textContent='Choose a folder in the Windows dialog…';const r=await api.fetchApi('/uninodes/sampler/browse-folder',{method:'POST'});const raw=await r.text();let d;try{d=JSON.parse(raw);}catch{throw Error(`HTTP ${r.status}: ${raw.slice(0,120).trim()} — restart ComfyUI and check Uninodes installation`);}if(!r.ok)throw Error(d.error||'Native folder dialog unavailable');if(d.cancelled){if(n._dsProgressLabel)n._dsProgressLabel.textContent='Folder selection cancelled';return;}n.properties??={};n.properties.ds_output_folder=d.folder;n.properties.ds_native_folder_label=d.display;graphDirty();render(n);}catch(err){if(n._dsProgressLabel)n._dsProgressLabel.textContent=err.message;}}
async function saveSelected(n){const item=n._dsResults?.[n._dsResultIndex||0];if(!item?.ds_token){n._dsProgressLabel.textContent='No result to save';return;}const format=n.properties?.ds_export_format||'PNG';const r=await api.fetchApi('/uninodes/sampler/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:item.ds_token,folder:n.properties?.ds_output_folder||'',format})});const data=await r.json();if(!r.ok)throw Error(data.error||'Save failed');n._dsProgressLabel.textContent=`Saved ${data.filename}`;}
async function autoSaveDS(n,images){if(!n.properties?.ds_autosave)return;const folder=n.properties.ds_output_folder||'';const format=n.properties?.ds_export_format||'PNG';let saved=0;for(const image of images){if(!image?.ds_token)continue;const r=await api.fetchApi('/uninodes/sampler/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:image.ds_token,folder,format})});const data=await r.json();if(!r.ok)throw Error(data.error||'Autosave failed');saved++;}if(n._dsProgressLabel)n._dsProgressLabel.textContent=`Autosaved ${saved} image${saved===1?'':'s'}`;}

function sanitizeSeed(value){
  // Comfy supports uint64 seeds, but JS number inputs only preserve integers up to 2^53-1.
  return Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Number(value)||0));
}
function randomSeed(){
  const values=new Uint32Array(2);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(values);
  else {values[0]=Math.floor(Math.random()*2**32);values[1]=Math.floor(Math.random()*2**32);}
  return (values[0]*2**21+(values[1]&0x1fffff)) || 1;
}
function nextSeed(seed, mode){
  const current=sanitizeSeed(seed);
  if(mode==='increment')return current>=Number.MAX_SAFE_INTEGER?0:current+1;
  if(mode==='decrement')return current<=0?Number.MAX_SAFE_INTEGER:current-1;
  return randomSeed();
}
function nativeSeedControls(n){return(n.widgets||[]).filter(w=>w.name==='control_after_generate'||w.name==='control_after_generate_seed'||w.name==='seed_control_after_generate'||w.name==='seed_control');}
function disableNativeSeedAutomation(n){for(const w of nativeSeedControls(n))w.value='fixed';}
function seedControls(n){
  n.properties??={};
  if(!n.properties.ds_seed_controls){
    const cfg=parse(n);
    const legacy=cfg.seed_mode||cfg.seed_after_generate||nativeSeedControls(n)[0]?.value||'randomize';
    const mode=legacy==='increment'?'increment':legacy==='decrement'?'decrement':'random';
    n.properties.ds_seed_controls={lock:Boolean(cfg.seed_lock||legacy==='fixed'),mode};
  }
  return n.properties.ds_seed_controls;
}
function currentImageSeed(n){
  return sanitizeSeed(n.properties?.ds_last_queued_seed ?? n._dsLastImageSeed ?? n.properties?.ds_last_seed ?? val(n,'seed') ?? 0);
}
function displayedSeed(n){return sanitizeSeed(n._dsDisplaySeed??currentImageSeed(n));}
function setVisibleSeed(n,seed){
  const used=sanitizeSeed(seed);
  n._dsDisplaySeed=used;
  n._dsPendingSeed=used;
  const widget=get(n,'seed');
  if(widget)widget.value=used;
  if(n._dsSeedInput)n._dsSeedInput.value=String(used);
  return used;
}
function markGeneratedSeed(n,usedSeed){
  const used=sanitizeSeed(usedSeed);
  n._dsLastImageSeed=used;
  n.properties??={};
  n.properties.ds_last_seed=used;
  // The displayed seed was already set when this prompt was queued. Do not
  // advance after completion: interrupted attempts must advance next time too.
  // Also avoid overwriting a newer queued seed when an older prompt finishes.
  if(!n._dsManualNext && (n._dsLastSubmittedSeed==null || n._dsLastSubmittedSeed===used)){
    setVisibleSeed(n,used);
  }
  if(n._dsSeedNote && displayedSeed(n)===used)n._dsSeedNote.textContent=seedControls(n).lock?'🔒 Locked displayed seed.':'Seed used for the latest submitted generation.';
}
function queueSeedForNode(n){
  const controls=seedControls(n);
  const current=displayedSeed(n);
  const chosen=controls.lock||n._dsManualNext?current:nextSeed(current,controls.mode);
  setVisibleSeed(n,chosen);
  n._dsManualNext=false;
  n._dsLastSubmittedSeed=chosen;
  n.properties??={};
  n.properties.ds_last_queued_seed=chosen;
  if(n._dsSeedNote)n._dsSeedNote.textContent=controls.lock?'🔒 Reusing displayed seed.':'Seed selected for this generation (lock to reuse).';
  return chosen;
}
function patchSerializedWorkflowSeed(workflow,n,seed){
  const node=workflow?.nodes?.find?.(entry=>String(entry.id)===String(n.id));
  if(!node)return;
  const serializedWidgets=(n.widgets||[]).filter(w=>w.serialize!==false);
  const seedIndex=serializedWidgets.findIndex(w=>w.name==='seed');
  if(Array.isArray(node.widgets_values)&&seedIndex>=0 && seedIndex<node.widgets_values.length){
    node.widgets_values[seedIndex]=seed;
  }else if(node.widgets_values && !Array.isArray(node.widgets_values) && 'seed' in node.widgets_values){
    node.widgets_values.seed=seed;
  }
}
function installQueueSeedHook(){
  // API queuePrompt receives the graph *after* ComfyUI has serialized it and
  // *before* POST /prompt. Mutate that payload, not just the visible widget;
  // otherwise the number shown can differ from the seed actually sampled.
  // Do not intercept app.queuePrompt, which can be bypassed by some queue UIs.
  if(typeof api.queuePrompt!=='function'||api.queuePrompt.__dsSeedHook)return;
  const original=api.queuePrompt;
  const wrapped=function(...args){
    const data=args[1];
    if(data?.output && typeof data.output==='object'){
      for(const [id,entry] of Object.entries(data.output)){
        if(!isSamplerType(entry?.class_type) || !entry.inputs || !Object.hasOwn(entry.inputs,'seed'))continue;
        const n=findNode(id);
        if(!n || !isSamplerType(n.type))continue;
        const seed=queueSeedForNode(n);
        entry.inputs.seed=seed;
        patchSerializedWorkflowSeed(data.workflow,n,seed);
      }
    }
    return original.apply(this,args);
  };
  wrapped.__dsSeedHook=true;
  api.queuePrompt=wrapped;
}
function readConfigWithSeedMigration(n){
  const cfg=parse(n);
  if(cfg.vae_name==null || cfg.vae_name==='Embedded')cfg.vae_name='Internal';
  if(!cfg.clip_source)cfg.clip_source='Internal';
  if(!cfg.encoder_loader)cfg.encoder_loader='single';
  if(!cfg.encoder_type)cfg.encoder_type='stable_diffusion';
  if(!cfg.resolution_category)cfg.resolution_category='SDXL';
  if(!cfg.resolution_preset)cfg.resolution_preset='custom';
  if(!cfg.mode)cfg.mode='t2i';
  if(!cfg.i2i_strength)cfg.i2i_strength='Balanced';
  if(!cfg.i2i_resolution_mode)cfg.i2i_resolution_mode='source';
  ensureModeSettings(cfg);
  seedControls(n); // UI-only preferences live in node.properties, never settings_json.
  return cfg;
}

function resolutionLibrary(n){return n._dsOptions?.resolution_presets||{};}
function resolutionCategoryOptions(n){return Object.keys(resolutionLibrary(n)).map(k=>({value:k,label:k}));}
function resolutionPresets(n, category){return resolutionLibrary(n)[category]||[];}
function currentResolutionCategory(n,cfg){const categories=Object.keys(resolutionLibrary(n));return categories.includes(cfg.resolution_category)?cfg.resolution_category:(categories[0]||'SDXL');}
function currentResolutionPreset(n,cfg){return resolutionPresets(n,currentResolutionCategory(n,cfg)).find(p=>p.id===cfg.resolution_preset)||null;}
function updateProfileModeIfNeeded(n){if(val(n,'profile_mode')!=='Custom')setWidget(n,'profile_mode','Custom');}
function applyResolutionPreset(n, category, preset){update(n,c=>{c.resolution_category=category;c.resolution_preset=preset.id;c.width=preset.width;c.height=preset.height;});updateProfileModeIfNeeded(n);render(n);}
function swapResolution(n){update(n,c=>{const w=Number(c.width)||1024,h=Number(c.height)||1024;c.width=h;c.height=w;c.resolution_preset='custom';});updateProfileModeIfNeeded(n);render(n);}
function sourcePreviewURL(ref){return ref?previewURL(ref):'';}
function i2iStrengthOptions(n){return n._dsOptions?.i2i_strengths||['Preserve','Near','Guided','Balanced','Creative','Free'];}
function sourceInfo(cfg){return cfg.internal_init_image&&cfg.internal_init_image.filename?cfg.internal_init_image:null;}
function nearestResolutionPreset(n, category, width, height){const presets=resolutionPresets(n, category);if(!presets.length)return null;const targetRatio=width/height;const targetArea=width*height;let best=null,bestScore=Infinity;for(const p of presets){const pr=p.width/p.height;const ratioDiff=Math.abs(Math.log(pr/targetRatio));const areaDiff=Math.abs(Math.log((p.width*p.height)/targetArea));const score=ratioDiff*4+areaDiff;if(score<bestScore){bestScore=score;best=p;}}return best;}
function applySourceResolutionToConfig(n, c, source){if(!source)return; if(c.i2i_resolution_mode==='model_safe'){const category=currentResolutionCategory(n,c); const preset=nearestResolutionPreset(n, category, source.width, source.height); if(preset){c.width=preset.width;c.height=preset.height;c.resolution_preset=preset.id;} else {c.width=source.width;c.height=source.height;c.resolution_preset='custom';}} else {c.width=source.width;c.height=source.height;c.resolution_preset='custom';}}
function uploadSourceFile(n,file){const fd=new FormData();fd.append('file',file);return api.fetchApi('/uninodes/sampler/upload-source',{method:'POST',body:fd}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Upload failed');switchMode(n,'i2i',c=>{c.internal_init_image=d;applySourceResolutionToConfig(n,c,d);});updateProfileModeIfNeeded(n);render(n);return d;});}
function clearLegacyPreview(n){
  // Pre-0.1.3 native b_preview frames may still be attached to this LiteGraph
  // node.  Do not touch previews belonging to any other node.
  if(!n)return;
  if(app.nodePreviewImages)delete app.nodePreviewImages[String(n.id)];
  if(n.imgs)n.imgs=null;
}
function startSamplerEvents(){if(startSamplerEvents.done)return;startSamplerEvents.done=true;installQueueSeedHook();
  api.addEventListener('executing',event=>{const info=event.detail||{};const id=typeof info==='string'?info:info.display_node??info.node;liveNodeId=id==null?null:String(id);const n=findNode(liveNodeId);if(n){clearLegacyPreview(n);removeNativeDSPreview(n);if(n._dsFrameURL){URL.revokeObjectURL(n._dsFrameURL);n._dsFrameURL=null;}n._dsProgress.style.width='0%';n._dsProgressLabel.textContent='Sampling…';n._dsStage.textContent='Denoising';}});
  api.addEventListener('progress',event=>{const detail=event.detail||{};const id=String(detail.node??liveNodeId??'');const n=findNode(id);if(!n)return;const cur=Number(detail.value??0),total=Number(detail.max??1);n._dsProgress.style.width=`${Math.max(0,Math.min(100,total?100*cur/total:0))}%`;n._dsProgressLabel.textContent=`Step ${cur}/${total}`;});
  api.addEventListener('direct_sampler_frame',event=>{
    const d=event.detail||{};
    const n=findNode(d.node_id);
    if(n&&typeof d.image==='string'&&d.image.length)showFrame(n,`data:image/jpeg;base64,${d.image}`);
  });
  api.addEventListener('executed',event=>{
    const detail=event.detail||{};
    const n=findNode(String(detail.display_node??detail.node??''));
    if(!n)return;
    clearLegacyPreview(n);removeNativeDSPreview(n);
    finishPreview(n,detail.output);
    if(n.properties?.ds_autosave && Array.isArray(detail.output?.ds_images)){autoSaveDS(n,detail.output.ds_images).catch(err=>{if(n._dsProgressLabel)n._dsProgressLabel.textContent=`Autosave failed: ${err.message}`;});}
    const executedSeed=detail.output?.ds_seed?.[0];
    if(executedSeed!==undefined)markGeneratedSeed(n,executedSeed);
  });
  api.addEventListener('execution_error',event=>{const detail=event.detail||{};const n=findNode(String(detail.node_id??''));if(n)n._dsProgressLabel.textContent=detail.exception_message||'Error';});
}

function hideNative(n){for(const w of n.widgets||[]){if(!['checkpoint','profile_mode','seed','settings_json'].includes(w.name)&&!nativeSeedControls(n).includes(w))continue;if(w._dsHidden)continue;w._dsHidden=true;w.type='hidden';w.hidden=true;w.computeSize=()=>[0,-4];w.options??={};w.options.hidden=true;w.options.serialize=true;}disableNativeSeedAutomation(n);}
// ComfyUI/LiteGraph does not honor slot.hidden for native output sockets.
// To truly hide the unused circles, remove ONLY unconnected suffix outputs.
// The Python node's declared output indices are IMAGE=0, FINISHER=1,
// LATENT=2, POSITIVE_COND=3, NEGATIVE_COND=4. Keeping a canonical prefix
// avoids corrupting the index and type of any connected output.
const optionalOutputDefinitions=[
  ['latent','LATENT'], ['positive_cond','CONDITIONING'], ['negative_cond','CONDITIONING']
];
function optionalSockets(n){const c=parse(n),v=c.show_sockets||{};
  for(const [name,type]of Object.entries(portTypes)){
    const should=corePorts.has(name)||Boolean(v[name]);const idx=n.inputs?.findIndex(x=>x.name===name)??-1;
    if(!should && idx>=0 && !n.inputs[idx].link) n.removeInput(idx);
    if(should&&idx<0)n.addInput(name,type);
  }
  // CONDITIONING requires keeping LATENT as slot #2 for ComfyUI's fixed
  // server-side output indices. When conditioning is requested, show all
  // three extras rather than a misleading ghost slot.
  const requested=v.conditioning_outputs?5:v.latent_output?3:2;
  let keepCount=requested;
  for(let i=2;i<(n.outputs?.length||0);i++){
    if(n.outputs[i]?.links?.length) keepCount=Math.max(keepCount,i+1);
  }
  // Prune from the end only, and never drop a connected socket.
  while((n.outputs?.length||0)>keepCount){
    const last=n.outputs.length-1;
    if(n.outputs[last]?.links?.length || typeof n.removeOutput!=='function')break;
    n.removeOutput(last);
  }
  // Restore outputs in their exact original order, so connecting an optional
  // socket always maps to the Python RETURN_TYPES without reindexing links.
  while((n.outputs?.length||0)<keepCount && typeof n.addOutput==='function'){
    const index=n.outputs.length;
    const spec=optionalOutputDefinitions[index-2];
    if(!spec)break;
    n.addOutput(spec[0],spec[1]);
  }
  for(let i=2;i<(n.outputs?.length||0);i++){
    const slot=n.outputs[i],spec=optionalOutputDefinitions[i-2];
    if(!spec)continue;
    if(!slot.name || slot.name!==spec[0])slot.name=spec[0];
    // Clear labels that older patches replaced with an invisible character.
    if(!slot.label || slot.label==='​')slot.label=spec[0];
    slot.hidden=false;
  }
  graphDirty();
}
function resize(n){if(typeof n.addDOMWidget!=='function')return;const width=Math.max(790,n.size?.[0]||0);const height=Math.max(610,n.size?.[1]||0);n.setSize?.([width,height]);}
function restorePreviewState(n){if(!n)return;const stored=Array.isArray(n.properties?.ds_preview_images)?n.properties.ds_preview_images.slice(0,12):[];if(stored.length){n._dsResults=stored;const maxIndex=Math.max(0,Math.min(n._dsResultIndex||0,stored.length-1));n._dsResultIndex=maxIndex;const selected=stored[maxIndex];n._dsFinalURL=previewURL(selected);if(n._dsDimensions)n._dsDimensions.textContent=selected?.width&&selected?.height?`${selected.width} × ${selected.height}`:'';if(n._dsView&&n._dsPlaceholder)setPreview(n,n._dsFinalURL,'Final image');if(n._dsGallery)rebuildGallery(n);}else if(n._dsFrameURL&&n._dsView&&n._dsPlaceholder){setPreview(n,n._dsFrameURL,'Denoising');}}
function installVisibilityRestore(){if(installVisibilityRestore.done)return;installVisibilityRestore.done=true;const restoreAll=()=>{for(const node of nodes.values()){try{restorePreviewState(node);removeNativeDSPreview(node);}catch{}}};window.addEventListener('pageshow',restoreAll);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')restoreAll();});}
function removeNativeDSPreview(n){if(!n)return;try{if(app.nodePreviewImages)delete app.nodePreviewImages[String(n.id)];n.imgs=null;}catch{}}
function attachSplitter(frame,node,key='ds_left_ratio'){
  const splitter=e('div','ds-splitter');
  splitter.title='Drag to resize panels';
  const variable='--ds-left';
  const clamp=(raw)=>Math.max(0.26,Math.min(0.62,Number(raw)||0.39));
  let ratio=clamp(node.properties?.[key]??0.39);
  let pointerId=null;
  let bounds=null;
  const paint=()=>frame.style.setProperty(variable,`${Math.round(ratio*1000)/10}%`);
  paint();
  splitter.addEventListener('pointerdown',ev=>{
    if(pointerId!==null||ev.button!==0)return;
    ev.preventDefault();ev.stopPropagation();
    pointerId=ev.pointerId;
    bounds=frame.getBoundingClientRect();
    // The ComfyUI canvas normally owns node drags. Capturing this pointer on
    // the divider keeps the drag inside the node and delivers pointerup even
    // when the mouse is released away from the narrow handle.
    splitter.setPointerCapture(pointerId);
    splitter.classList.add('dragging');
  });
  splitter.addEventListener('pointermove',ev=>{
    if(pointerId!==ev.pointerId||!bounds)return;
    ev.preventDefault();ev.stopPropagation();
    ratio=clamp((ev.clientX-bounds.left)/Math.max(1,bounds.width));
    paint();
    // Don't mark the graph dirty on every pixel: ComfyUI can redraw/recreate
    // widgets, which would break capture in the middle of a drag.
  });
  const finish=(ev)=>{
    if(pointerId!==ev.pointerId)return;
    ev.stopPropagation();
    const id=pointerId;
    pointerId=null;
    bounds=null;
    splitter.classList.remove('dragging');
    if(splitter.hasPointerCapture(id))splitter.releasePointerCapture(id);
    node.properties??={};
    node.properties[key]=ratio;
    graphDirty();
  };
  splitter.addEventListener('pointerup',finish);
  splitter.addEventListener('pointercancel',finish);
  splitter.addEventListener('lostpointercapture',ev=>{
    if(pointerId!==ev.pointerId)return;
    pointerId=null;bounds=null;splitter.classList.remove('dragging');
    node.properties??={};node.properties[key]=ratio;
    graphDirty();
  });
  return splitter;
}

function render(n){const root=n._dsRoot;if(!root)return;const cfg=n._dsConfig||parse(n);const mode=cfg.mode==='i2i'?'i2i':'t2i';root.classList.toggle('ds-compact',cfg.preview_layout==='compact');root.classList.toggle('ds-mode-i2i',mode==='i2i');root.replaceChildren();const frame=e('div','ds-frame');const left=e('section','ds-left');const right=e('section','ds-right');frame.append(left,attachSplitter(frame,n),right);root.append(frame);
  const placeholderText=mode==='i2i'?'Load a source image or connect init_image externally, then Queue Prompt.\nLive sampling previews appear here.':'Connect positive / negative text from Prompt Composer, then Queue Prompt.\nLive sampling previews appear here.';
  function settingField(label,key,{type='number',options=null,step=1,onChange=null}={}){const ctl=options?select(cfg[key],options):textBox(cfg[key],type,step);ctl.addEventListener('change',()=>{update(n,c=>{c[key]=type==='number'&&!options?Number(ctl.value):type==='checkbox'?ctl.checked:ctl.value;if(key==='width'||key==='height'){c.resolution_preset='custom';}onChange?.(c, ctl.value);});updateProfileModeIfNeeded(n);render(n);});return field(label,ctl);}
  const header=e('div','ds-header');header.append(e('span','ds-icon',mode==='i2i'?'◉':'◈'));const headerText=e('div');headerText.append(e('div','ds-title','DIRECT SAMPLER'),e('div','ds-caption',mode==='i2i'?'Image-to-Image studio':'Text-to-Image studio'));header.append(headerText);const actions=e('div','ds-top-actions');actions.append(btn('T2I',()=>{switchMode(n,'t2i');render(n);},'ds-chip'+(mode==='t2i'?' active':'')),btn('I2I',()=>{switchMode(n,'i2i',c=>{if(!c.i2i_strength)c.i2i_strength='Balanced';if(sourceInfo(c))applySourceResolutionToConfig(n,c,sourceInfo(c));if(c.denoise===1)c.denoise=0.55;});render(n);},'ds-chip'+(mode==='i2i'?' active':'')));const settingsBtn=btn('⚙',()=>openSettings(n));actions.append(settingsBtn);header.append(actions);left.append(header);

  if(mode==='i2i'){
    const sourceCard=e('div','ds-card');sourceCard.append(e('div','ds-card-title','Source image'));
    const source=sourceInfo(cfg);const sourceGrid=e('div','ds-source-grid');const thumb=e('div','ds-source-thumb');if(source){const im=e('img');im.src=sourcePreviewURL(source);thumb.append(im);}else thumb.append(e('div','ds-muted','No source\nloaded'));
    const meta=e('div','ds-source-meta');meta.append(e('div','ds-source-name',source?.name||'No internal source image selected'));
    const info=e('div','ds-source-details',source?`${source.width} × ${source.height}${source.filename?' · '+source.filename:''}`:'Upload a source image, or connect init_image externally.');meta.append(info);
    const buttonRow=e('div','ds-row');const fileInput=e('input');fileInput.type='file';fileInput.accept='image/*';fileInput.style.display='none';fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];if(!file)return;info.textContent='Uploading…';try{await uploadSourceFile(n,file);}catch(err){info.textContent=err.message||'Upload failed';}});meta.append(fileInput);buttonRow.append(btn(source?'Replace':'Load image',()=>fileInput.click(),'ds-primary'));if(source)buttonRow.append(btn('Clear',()=>{update(n,c=>{c.internal_init_image=null;});render(n);}));meta.append(buttonRow);
    if(n.inputs?.find(i=>i.name==='init_image'&&i.link!=null))meta.append(e('div','ds-upload-note','External init_image is connected and will override the internal image while sampling.'));
    sourceGrid.append(thumb,meta);sourceCard.append(sourceGrid);
    const resMode=e('div','ds-field');resMode.append(e('span','','Resolution behavior'));const modeRow=e('div','ds-res-mode');for(const [value,label] of [['source','Keep source'],['model_safe','Model safe']]){modeRow.append(btn(label,()=>{update(n,c=>{c.i2i_resolution_mode=value;if(sourceInfo(c))applySourceResolutionToConfig(n,c,sourceInfo(c));});render(n);},value===cfg.i2i_resolution_mode?'active':''));}resMode.append(modeRow);sourceCard.append(resMode);
    const strengthField=e('div','ds-field');strengthField.append(e('span','','Strength'));const strengthRow=e('div','ds-segment-row');for(const label of i2iStrengthOptions(n)){strengthRow.append(btn(label,()=>{const values={Preserve:0.15,Near:0.28,Guided:0.40,Balanced:0.55,Creative:0.72,Free:0.88};update(n,c=>{c.i2i_strength=label;c.denoise=values[label]??0.55;});render(n);},label===cfg.i2i_strength?'active':''));}strengthField.append(strengthRow,e('div','ds-upload-note','A friendly control for img2img denoise. You can still fine-tune the exact denoise value in Settings if needed.'));sourceCard.append(strengthField);
    left.append(sourceCard);
  }

  const checkpointCard=e('div','ds-card');checkpointCard.append(e('div','ds-card-title','Model & profile'));
  const ckpt=select(val(n,'checkpoint'),n._dsOptions?.checkpoints||[val(n,'checkpoint')]);ckpt.addEventListener('change',async()=>{n._dsProfileRequest=(n._dsProfileRequest||0)+1;setWidget(n,'checkpoint',ckpt.value);n._dsProfileMessage='';if(val(n,'profile_mode')!=='Custom')await refreshProfile(n);else render(n);});checkpointCard.append(field('Checkpoint / diffusion model',ckpt));if(String(val(n,'checkpoint')||'').startsWith('[Diffusion] '))checkpointCard.append(e('div','ds-muted','Diffusion model-only: the matching text encoder and VAE must also be available.'));
  const modes=e('div','ds-mode');for(const profile of ['Creator','Personal','Custom'])modes.append(btn(profile,async()=>{if(profile==='Custom'){n._dsProfileRequest=(n._dsProfileRequest||0)+1;setWidget(n,'profile_mode',profile);n._dsProfileMessage='Custom settings — not linked to a saved profile.';render(n);}else{setWidget(n,'profile_mode',profile);await refreshProfile(n);}},profile===val(n,'profile_mode')?'active':''));checkpointCard.append(modes);
  const profileActions=e('div','ds-profile-actions');profileActions.append(btn('Save Creator',()=>saveSamplerProfile(n,'Creator')),btn('Save Personal',()=>saveSamplerProfile(n,'Personal')));
  const activeMode=val(n,'profile_mode');if(activeMode!=='Custom')profileActions.append(btn('Delete '+activeMode,()=>deleteSamplerProfile(n,activeMode)));
  checkpointCard.append(profileActions,e('div','ds-profile-note',n._dsProfileMessage||'Creator / Personal: saved settings for this model, shared with both sampler nodes. Custom: independent edits.'));
  left.append(checkpointCard);

  // Prefixes belong to the sampler, not the prompt editor. They are stored in
  // settings_json for Custom mode and saved into Creator/Personal on demand.
  // Collapsing the editor never disables an enabled prefix.
  const prefixCard=e('div','ds-card ds-prefix-card');
  const prefixHead=e('div','ds-prefix-head');
  prefixHead.append(e('div','ds-card-title','Prompt prefixes'));
  const prefixSwitch=e('label','ds-prefix-toggle');
  const prefixEnabled=textBox(Boolean(cfg.apply_profile_prefixes),'checkbox');
  prefixEnabled.title='Prepend these prefixes to the connected prompt texts';
  prefixEnabled.addEventListener('change',()=>update(n,c=>{c.apply_profile_prefixes=prefixEnabled.checked;}));
  prefixSwitch.append(prefixEnabled,e('span','',prefixEnabled.checked?'On':'Off'));
  prefixHead.append(prefixSwitch);
  const prefixExpanded=Boolean(n.properties?.ds_prefix_expanded);
  const expandPrefix=btn(prefixExpanded?'▾':'▸',()=>{
    n.properties??={};n.properties.ds_prefix_expanded=!n.properties.ds_prefix_expanded;
    graphDirty();render(n);
  },'ds-prefix-expand');
  expandPrefix.setAttribute('aria-expanded',String(prefixExpanded));
  expandPrefix.title=prefixExpanded?'Collapse prefix editor':'Edit positive and negative prefixes';
  prefixHead.append(expandPrefix);prefixCard.append(prefixHead);
  if(prefixExpanded){
    const prefixBody=e('div','ds-prefix-body');
    for(const [key,title] of [['positive_prefix','Positive'],['negative_prefix','Negative']]){
      const wrapper=e('label','ds-prefix-field');wrapper.append(e('span','',title));
      const area=e('textarea','ds-prefix-textarea');
      area.rows=2;area.maxLength=12000;area.spellcheck=false;
      area.placeholder=title==='Positive'?'e.g. masterpiece, best quality':'e.g. worst quality, low quality';
      area.value=String(cfg[key]??'');
      // Persist each edit without rerendering: rerender-on-keystroke would
      // replace the focused textarea and make continuous typing impossible.
      area.addEventListener('input',()=>{
        if(String((n._dsConfig||parse(n))[key]??'')===area.value)return;
        const changed=ensureModeSettings(structuredClone(n._dsConfig||parse(n)));
        changed[key]=area.value;
        n._dsConfig=changed;
        setWidget(n,'settings_json',JSON.stringify(changed));
        const previousMode=val(n,'profile_mode');
        updateProfileModeIfNeeded(n);
        if(previousMode!=='Custom'){
          for(const button of modes.querySelectorAll('button'))
            button.classList.toggle('active',button.textContent==='Custom');
          const note=checkpointCard.querySelector('.ds-profile-note');
          if(note)note.textContent='Custom prefix edits — Save Creator / Personal to store this preset.';
        }
      });
      // No rerender on blur: replacing DOM on change can consume a pending
      // Save Profile click and interrupt text editing.
      wrapper.append(area);prefixBody.append(wrapper);
    }
    prefixBody.append(e('div','ds-prefix-hint','Added before your prompt when On. Editing switches to Custom; Save Creator / Personal to store it for this model.'));
    prefixCard.append(prefixBody);
  }else if(cfg.positive_prefix||cfg.negative_prefix){
    prefixCard.append(e('div','ds-prefix-hint','Positive / negative prefixes configured · expand to edit'));
  }
  left.append(prefixCard);

  const encoderCard=e('div','ds-card');encoderCard.append(e('div','ds-card-title','Encoders'));const encoderRow=e('div','ds-2col');const vaeChoices=[{value:'Internal',label:'Internal'},{value:'External',label:'External'},...(n._dsOptions?.vaes||[]).map(v=>({value:v,label:v}))];const clipChoices=[{value:'Internal',label:'Auto / embedded'},{value:'Manual',label:'Select encoders'},{value:'External',label:'External socket'}];encoderRow.append(settingField('VAE','vae_name',{type:'text',options:vaeChoices}),settingField('CLIP','clip_source',{type:'text',options:clipChoices}));encoderCard.append(encoderRow,e('div','ds-encoder-note','Auto uses embedded encoders or exact known model-family companions. Select encoders for other model-only families; External uses a connected CLIP socket.'));
  if(cfg.clip_source==='Manual'){
    const encoderMode=select(cfg.encoder_loader||'single',[{value:'single',label:'Single'},{value:'dual',label:'Dual'},{value:'triple',label:'Triple (SD3)'},{value:'quad',label:'Quad (HiDream)'}]);
    encoderMode.addEventListener('change',()=>update(n,c=>{c.encoder_loader=encoderMode.value;c.encoder_type=encoderMode.value==='dual'?'flux':'stable_diffusion';}));
    encoderCard.append(field('Encoder loader',encoderMode));
    const supportedTypes=n._dsOptions?.encoder_types?.[cfg.encoder_loader||'single']||[];
    if(supportedTypes.length){const encoderType=select(cfg.encoder_type||'stable_diffusion',supportedTypes);encoderType.addEventListener('change',()=>update(n,c=>{c.encoder_type=encoderType.value;}));encoderCard.append(field('Encoder type',encoderType));}
    const count={single:1,dual:2,triple:3,quad:4}[cfg.encoder_loader||'single']||1;
    const encoderOptions=[{value:'',label:'— Select an encoder —'},...(n._dsOptions?.text_encoders||[]).map(x=>({value:x,label:x}))];
    for(let i=1;i<=count;i++){const name=`encoder_${i}`;const control=select(cfg[name]||'',encoderOptions);control.addEventListener('change',()=>update(n,c=>{c[name]=control.value;}));encoderCard.append(field(`Text encoder ${i}`,control));}
  }
  left.append(encoderCard);

  const samplerCard=e('div','ds-card');samplerCard.append(e('div','ds-card-title','Sampling'));const row=e('div',mode==='i2i'?'ds-2col':'ds-3col');row.append(settingField('Steps','steps',{step:1}),settingField('CFG','cfg',{step:0.5}));if(mode!=='i2i')row.append(settingField('Denoise','denoise',{step:0.01}));samplerCard.append(row);const row2=e('div','ds-2col');row2.append(settingField('Sampler','sampler_name',{type:'text',options:n._dsOptions?.samplers||[cfg.sampler_name]}),settingField('Scheduler','scheduler',{type:'text',options:n._dsOptions?.schedulers||[cfg.scheduler]}));samplerCard.append(row2);
  const row3=e('div','ds-seed-row');const seedField=e('label','ds-field');seedField.append(e('span','','Seed'));const seed=textBox(displayedSeed(n),'number');n._dsSeedInput=seed;seed.min='0';seed.max='9007199254740991';seed.step='1';seed.title='Seed associated with the displayed image (editable)';seed.addEventListener('change',()=>{const value=sanitizeSeed(seed.value);seed.value=String(value);setVisibleSeed(n,value);n._dsManualNext=true;if(seedControls(n).lock){seedControls(n).lock=false;graphDirty();render(n);}if(n._dsSeedNote)n._dsSeedNote.textContent='Selected seed — not generated yet.';});
  const controls=e('div','ds-seed-controls');const state=seedControls(n);const lockBtn=btn(state.lock?'🔒':'🔓',()=>{state.lock=!state.lock;if(state.lock)setVisibleSeed(n,displayedSeed(n));graphDirty();render(n);},'ds-chip'+(state.lock?' active':''));lockBtn.title=state.lock?'Unlock image seed':'Lock seed of displayed image';controls.append(lockBtn);const nextMode=select(state.mode,[{value:'random',label:'♻️'},{value:'increment',label:'➕'},{value:'decrement',label:'➖'}]);nextMode.title='Unlocked seed mode';nextMode.addEventListener('change',()=>{state.mode=nextMode.value;graphDirty();render(n);});controls.append(nextMode);const random=btn('🎲',()=>{const value=randomSeed();setVisibleSeed(n,value);n._dsManualNext=true;seed.value=String(value);if(state.lock){state.lock=false;graphDirty();render(n);}if(n._dsSeedNote)n._dsSeedNote.textContent='Selected seed — not generated yet.';},'ds-chip');random.title='Roll a new seed for next generation';controls.append(random);const wrap=e('div','ds-seed-wrap');wrap.append(seed,controls);seedField.append(wrap);const note=e('div','ds-seed-note',state.lock?'🔒 Reuse displayed image seed.':'New seed selected when queued. Lock to reuse displayed seed.');n._dsSeedNote=note;seedField.append(note);row3.append(seedField);samplerCard.append(row3);left.append(samplerCard);

  const resolutionCard=e('div','ds-card');resolutionCard.append(e('div','ds-card-title','Resolution'));const resWrap=e('div','ds-resolution-grid');const leftSide=e('div','ds-ratio-card');const ratioPreview=e('div','ds-ratio-preview');const rect=e('div','ds-ratio-rect');const maxW=112,maxH=90;const w=Number(cfg.width)||1024,h=Number(cfg.height)||1024;const ratioScale=Math.min(maxW/w,maxH/h);rect.style.width=`${Math.max(18,Math.round(w*ratioScale))}px`;rect.style.height=`${Math.max(18,Math.round(h*ratioScale))}px`;ratioPreview.append(rect,e('div','ds-ratio-size',`${w} × ${h}`));leftSide.append(ratioPreview);const toolRow=e('div','ds-inline-tools');toolRow.append(btn('Swap',()=>swapResolution(n)),e('span','ds-muted',`${(w/h).toFixed(2)} ratio`));leftSide.append(toolRow);const sizeRow=e('div','ds-2col');sizeRow.append(settingField('Width','width',{step:8}),settingField('Height','height',{step:8}));leftSide.append(sizeRow);if(w%8!==0||h%8!==0||w>4096||h>4096||w<64||h<64){const issue=w>4096||h>4096?'exceeds Direct Sampler’s 4096 px limit':w%8||h%8?'must use multiples of 8':'must be at least 64 px';leftSide.append(e('div','ds-res-warning',`⚠ ${w} × ${h} ${issue}. Adjust W/H before sampling.`));}resWrap.append(leftSide);
  const rightSide=e('div','ds-ratio-card');const category=currentResolutionCategory(n,cfg);const categoryCtl=select(category,resolutionCategoryOptions(n));categoryCtl.addEventListener('change',()=>update(n,c=>{c.resolution_category=categoryCtl.value;c.resolution_preset='custom';if(c.mode==='i2i'&&c.i2i_resolution_mode==='model_safe'&&sourceInfo(c))applySourceResolutionToConfig(n,c,sourceInfo(c));}));rightSide.append(field('Category',categoryCtl));const presetGrid=e('div','ds-preset-grid');const presets=resolutionPresets(n,category);const selectedPreset=currentResolutionPreset(n,cfg);for(const preset of presets){const b=btn('',()=>applyResolutionPreset(n,category,preset),'ds-preset-btn'+(selectedPreset?.id===preset.id?' active':''));const mini=e('div','ds-mini-rect');const s=Math.min(34/preset.width,26/preset.height);mini.style.width=`${Math.max(14,Math.round(preset.width*s))}px`;mini.style.height=`${Math.max(12,Math.round(preset.height*s))}px`;const meta=e('div','ds-preset-meta');meta.append(e('b','',preset.name),e('span','',`${preset.width}×${preset.height}`));b.append(mini,meta);presetGrid.append(b);}rightSide.append(field('Presets',presetGrid));resWrap.append(rightSide);resolutionCard.append(resWrap);left.append(resolutionCard);

  const loraCard=e('div','ds-card');const loraHeading=e('div','ds-row ds-between');loraHeading.append(e('span','ds-card-title',`LoRAs (${(cfg.loras||[]).filter(isEnabled).length})`),btn('+ Add LoRA',()=>update(n,c=>{c.loras??=[];if(c.loras.length<16)c.loras.push({name:'',enabled:true,strength_model:1,strength_clip:1,trigger:'',use_trigger:false});})));loraCard.append(loraHeading);const list=e('div','ds-lora-list');list.style.display='flex';list.style.flexDirection='column';list.style.gap='6px';for(let i=0;i<(cfg.loras||[]).length;i++){const entry=cfg.loras[i],panel=e('div','ds-lora');const main=e('div','ds-lora-main');const enabled=textBox(entry.enabled!==false,'checkbox');enabled.title='Enabled';enabled.addEventListener('change',()=>update(n,c=>{c.loras[i].enabled=enabled.checked;}));main.append(enabled);const name=select(entry.name||'',[{value:'',label:'— Choose LoRA —'},...(n._dsOptions?.loras||[]).map(s=>({value:s,label:s}))]);name.title='LoRA';name.addEventListener('change',()=>update(n,c=>{c.loras[i].name=name.value;c.loras[i].trigger=rememberedLoRATrigger(name.value);if(!c.loras[i].trigger)c.loras[i].use_trigger=false;}));main.append(name);for(const [key,title] of [['strength_model','Model'],['strength_clip','CLIP']]){const wrapper=e('div','ds-lora-col');wrapper.append(e('span','',title));const x=textBox(entry[key]??1,'number',0.05);x.min='-5';x.max='5';x.title=`${title} strength`;x.addEventListener('change',()=>update(n,c=>{c.loras[i][key]=Number(x.value)||0;}));wrapper.append(x);main.append(wrapper);}main.append(btn('×',()=>update(n,c=>{c.loras.splice(i,1);}),'ds-lora-delete'));panel.append(main);const tools=e('div','ds-lora-tools');const details=e('details');n._dsOpenLoraRows??=new Set();details.open=n._dsOpenLoraRows.has(i);details.addEventListener('toggle',()=>{if(details.open)n._dsOpenLoraRows.add(i);else n._dsOpenLoraRows.delete(i);});const summary=e('summary','ds-muted',rememberedLoRATrigger(entry.name)?'Trigger words · remembered':'Trigger words (optional)');details.append(summary);const trigger=textBox(entry.trigger||'');trigger.placeholder='Trigger words';trigger.maxLength=1000;trigger.addEventListener('change',()=>{
    const row=n._dsConfig?.loras?.[i];
    if(!row)return;
    row.trigger=trigger.value;
    // Update the hidden serialized widget without recreating the text input.
    setWidget(n,'settings_json',JSON.stringify(n._dsConfig));
    if(!row.name)return;
    summary.textContent='Saving trigger words…';
    rememberLoRATrigger(row.name,row.trigger)
      .then(()=>{if(details.isConnected)summary.textContent=row.trigger?'Trigger words · saved globally':'Trigger words · global entry cleared';})
      .catch(err=>{console.warn('[Uninodes] LoRA trigger save:',err);if(details.isConnected)summary.textContent='Trigger words · save failed';});
  });details.append(field('Prompt addition',trigger));const use=e('label','ds-row');const useCb=textBox(entry.use_trigger,'checkbox');useCb.addEventListener('change',()=>update(n,c=>{c.loras[i].use_trigger=useCb.checked;}));use.append(useCb,e('span','ds-muted','Append trigger to positive prompt'));details.append(use);tools.append(details);tools.append(btn('↑',()=>update(n,c=>{if(i>0)[c.loras[i-1],c.loras[i]]=[c.loras[i],c.loras[i-1]];})),btn('↓',()=>update(n,c=>{if(i<c.loras.length-1)[c.loras[i],c.loras[i+1]]=[c.loras[i+1],c.loras[i]];})));panel.append(tools);list.append(panel);}loraCard.append(list);left.append(loraCard);

  const previewHead=e('div','ds-preview-head');previewHead.append(e('strong','','PREVIEW'));const status=e('span','ds-caption','Ready');n._dsStage=status;previewHead.append(status);const selectedImage=n._dsResults?.[Math.min(n._dsResultIndex||0,(n._dsResults?.length||1)-1)];const size=selectedImage?.width&&selectedImage?.height?`${selectedImage.width} × ${selectedImage.height}`:'';const dimensions=e('span','ds-preview-dimensions',size);n._dsDimensions=dimensions;previewHead.append(dimensions);right.append(previewHead);const preview=e('div','ds-preview-frame');const placeholder=e('div','ds-empty',placeholderText);placeholder.style.whiteSpace='pre-line';const img=e('img');img.hidden=true;img.addEventListener('error',()=>{img.style.display='none';img.hidden=true;});img.addEventListener('load',()=>{img.style.display='';img.hidden=false;});preview.append(placeholder,img);n._dsView=img;n._dsPlaceholder=placeholder;right.append(preview);
  let scale=1,tx=0,ty=0,start=null;preview.addEventListener('wheel',ev=>{ev.preventDefault();ev.stopPropagation();scale=Math.max(1,Math.min(8,scale+(ev.deltaY<0?0.25:-0.25)));img.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;},{passive:false});preview.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;ev.stopPropagation();start={x:ev.clientX-tx,y:ev.clientY-ty};preview.setPointerCapture(ev.pointerId);});preview.addEventListener('pointermove',ev=>{if(!start)return;tx=ev.clientX-start.x;ty=ev.clientY-start.y;img.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;});preview.addEventListener('pointerup',()=>start=null);
  const progress=e('div','ds-progress');const bar=e('div');progress.append(bar);n._dsProgress=bar;right.append(progress);const infoRow=e('div','ds-row ds-between');const progressLabel=e('span','ds-muted','Ready');n._dsProgressLabel=progressLabel;infoRow.append(progressLabel,btn('Fit / Reset',()=>{scale=1;tx=ty=0;img.style.transform='';}));right.append(infoRow);const gallery=e('div','ds-gallery');n._dsGallery=gallery;right.append(gallery);const bottom=e('div','ds-bottom');const folderGroup=e('div','ds-output-folder');const folderCtl=e('select');const currentFolder=n.properties?.ds_output_folder||'';const folders=n._dsOutputFolders||[''];for(const f of folders){const o=e('option','',f||'output /');o.value=f;folderCtl.append(o);}if(!folders.includes(currentFolder)){const o=e('option','',currentFolder.startsWith('native:')?(n.properties?.ds_native_folder_label||'Windows folder'):`${currentFolder} (missing)`);o.value=currentFolder;folderCtl.append(o);}folderCtl.value=currentFolder;folderCtl.title=n.properties?.ds_native_folder_label||'Destination inside ComfyUI/output';folderCtl.addEventListener('change',()=>{n.properties??={};n.properties.ds_output_folder=folderCtl.value;graphDirty();});folderGroup.append(folderCtl,btn('📂',()=>browseOutputFolder(n)),btn('+',()=>createOutputFolder(n)));bottom.append(folderGroup);const formatCtl=e('select','ds-format');for(const f of ['PNG','JPEG','WEBP','TIFF','BMP','GIF']){const o=e('option','',f);o.value=f;formatCtl.append(o);}formatCtl.value=n.properties?.ds_export_format||'PNG';formatCtl.title='Export image format';formatCtl.addEventListener('change',()=>{n.properties??={};n.properties.ds_export_format=formatCtl.value;graphDirty();});bottom.append(formatCtl);const saveActions=e('div','ds-save-actions');saveActions.append(btn('Save',async()=>{try{await saveSelected(n);}catch(err){n._dsProgressLabel.textContent=err.message;}},'ds-primary'));bottom.append(saveActions);const autoLabel=e('label','ds-autosave');const autoCheck=textBox(Boolean(n.properties?.ds_autosave),'checkbox');autoCheck.addEventListener('change',()=>{n.properties??={};n.properties.ds_autosave=autoCheck.checked;graphDirty();});autoLabel.append(autoCheck,e('span','','Autosave'));bottom.append(autoLabel);right.append(bottom);if(n._dsResults?.length){const selected=n._dsResults[Math.min(n._dsResultIndex||0,n._dsResults.length-1)];setPreview(n,previewURL(selected),'Final image');rebuildGallery(n);}else if(n._dsFrameURL)setPreview(n,n._dsFrameURL,'Denoising');if(n._dsCombined){
    // Deluxe uses the Finisher compare area as the main visual stage.
    // Keep only the generation progress summary in the sampler column.
    const progressCard=e('div','ds-card ds-combined-progress');
    progressCard.append(e('div','ds-card-title','Generation progress'));
    progressCard.append(n._dsProgress.parentElement);
    const statusRow=n._dsProgressLabel.parentElement;
    statusRow.querySelector('button')?.remove();
    progressCard.append(statusRow);
    left.append(progressCard);
  }}

const SAMPLER_PROFILE_FIELDS=['steps','cfg','denoise','sampler_name','scheduler','clip_skip','width','height','batch_size','vae_name','clip_source','encoder_loader','encoder_type','encoder_1','encoder_2','encoder_3','encoder_4','positive_prefix','negative_prefix'];
async function profileRequest(url,options){const response=await api.fetchApi(url,options);const data=await response.json();if(!response.ok)throw Error(data.error||`Profile request failed (HTTP ${response.status})`);return data.profile;}
async function refreshProfile(n){
 const ck=val(n,'checkpoint'),mode=val(n,'profile_mode');if(!ck||mode==='Custom'){render(n);return;}
 const requestId=(n._dsProfileRequest||0)+1;n._dsProfileRequest=requestId;
 try{
  const profile=await profileRequest(`/uninodes/sampler/profile?checkpoint=${encodeURIComponent(ck)}&mode=${encodeURIComponent(mode)}`);
  if(n._dsProfileRequest!==requestId||val(n,'checkpoint')!==ck||val(n,'profile_mode')!==mode)return;
  if(!profile?.values){setWidget(n,'profile_mode','Custom');n._dsProfileMessage=`No ${mode} profile saved for this model. Configure your settings and choose Save ${mode}.`;render(n);return;}
  const cfg=structuredClone(n._dsConfig||parse(n));for(const key of SAMPLER_PROFILE_FIELDS)if(key in profile.values)cfg[key]=profile.values[key];
  n._dsProfileMessage=`${mode} loaded (${profile.origin||'Uninodes'}).`;
  syncCurrentModeSettings(cfg);write(n,cfg);
 }catch(err){if(n._dsProfileRequest!==requestId)return;setWidget(n,'profile_mode','Custom');n._dsProfileMessage=`Profile load failed: ${err.message}`;render(n);}
}
async function saveSamplerProfile(n,mode,{draftSettings=null}={}){
 const ck=val(n,'checkpoint');if(!ck||n._dsSavingProfile)return false;
 n._dsSavingProfile=true;
 // The settings dialog owns a draft until Apply. Profile saves made there
 // must use that draft rather than the previously applied node settings.
 const cfg=draftSettings||n._dsConfig||parse(n);
 const values={};for(const key of SAMPLER_PROFILE_FIELDS)if(key in cfg)values[key]=cfg[key];
 try{
  // Keep the existing preset unless the user explicitly confirms replacement.
  const existing=await profileRequest(`/uninodes/sampler/profile?checkpoint=${encodeURIComponent(ck)}&mode=${mode}`);
  if(val(n,'checkpoint')!==ck)return false;
  if(existing?.origin==='Uninodes'&&!window.confirm(`Replace your saved ${mode} profile for ${ck}?`))return false;
  await profileRequest('/uninodes/sampler/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkpoint:ck,mode,values})});
  if(val(n,'checkpoint')!==ck)return false;
  n._dsProfileRequest=(n._dsProfileRequest||0)+1;
  // A successful modal save doubles as Apply; canceled/failed saves do not.
  if(draftSettings){syncCurrentModeSettings(cfg);write(n,cfg);optionalSockets(n);}
  setWidget(n,'profile_mode',mode);
  n._dsProfileMessage=`${mode} profile saved for ${ck} (Uninodes).`;
  render(n);
  return true;
 }catch(err){n._dsProfileMessage=`Couldn't save ${mode}: ${err.message}`;render(n);return false;}
 finally{n._dsSavingProfile=false;}
}
async function deleteSamplerProfile(n,mode){
 const ck=val(n,'checkpoint');if(!ck||!window.confirm(`Delete the saved ${mode} profile for ${ck}?`))return;
 try{
  const result=await profileRequest(`/uninodes/sampler/profile?checkpoint=${encodeURIComponent(ck)}&mode=${mode}`,{method:'DELETE'});
  if(val(n,'checkpoint')!==ck)return;
  n._dsProfileRequest=(n._dsProfileRequest||0)+1;
  setWidget(n,'profile_mode','Custom');
  n._dsProfileMessage=result?.origin?.startsWith('Legacy')?`Deleted Uninodes override; a read-only legacy ${mode} profile is still available.`:`${mode} profile deleted; current settings remain Custom.`;
  render(n);
 }catch(err){n._dsProfileMessage=`Couldn't delete ${mode}: ${err.message}`;render(n);}
}
function openSettings(n){const originalCfg=structuredClone(n._dsConfig||parse(n));const cfg=structuredClone(originalCfg);const overlay=e('div','ds-overlay');const modal=e('div','ds-modal');const header=e('header');header.append(e('strong','','Direct Sampler Settings'));const close=()=>overlay.remove();header.append(btn('✕',close));modal.append(header);const body=e('div','ds-modal-body'),nav=e('nav'),article=e('article');body.append(nav,article);modal.append(body);
 const footer=e('footer');
 const profileButtons=e('div','ds-profile-footer-actions');
 const creatorButton=btn('Save Creator',()=>saveDraftProfile('Creator'));
 const personalButton=btn('Save Personal',()=>saveDraftProfile('Personal'));
 profileButtons.append(creatorButton,personalButton);
 const saveMessage=e('span','ds-profile-footer-status');saveMessage.setAttribute('role','status');
 const commonButtons=e('div','ds-profile-footer-right');
 commonButtons.append(btn('Cancel',close),btn('Apply',()=>{flush?.();if(SAMPLER_PROFILE_FIELDS.some(key=>JSON.stringify(cfg[key])!==JSON.stringify(originalCfg[key])))updateProfileModeIfNeeded(n);write(n,cfg);optionalSockets(n);close();},'ds-primary'));
 footer.append(profileButtons,saveMessage,commonButtons);modal.append(footer);overlay.append(modal);document.body.append(overlay);stopGestures(modal);
 async function saveDraftProfile(mode){
  if(n._dsSavingProfile)return;
  flush?.(); // Include values that haven't been applied yet.
  saveMessage.textContent=`Saving ${mode}…`;
  creatorButton.disabled=personalButton.disabled=true;
  try{
   const saved=await saveSamplerProfile(n,mode,{draftSettings:cfg});
   if(saved)close();
   else saveMessage.textContent=n._dsProfileMessage?.startsWith("Couldn't")?n._dsProfileMessage:'Save cancelled.';
  }finally{creatorButton.disabled=personalButton.disabled=false;}
 }
 const sections=[['sampling','Sampling'],['resolution','Resolution & encoders'],['loras','LoRA & prompts'],['sockets','Optional sockets'],['preview','Preview & layout']];let flush=null;
 function addField(target,key,title,{options=null,type='number',step=1,defaultValue=null}={}){const input=options?select(target[key],options):textBox(target[key]??defaultValue,type,step);const f=field(title,input);article.append(f);return ()=>{target[key]=options?input.value:type==='number'?Number(input.value):type==='checkbox'?input.checked:input.value;};}
 function tab(id){flush?.();flush=null;nav.replaceChildren(...sections.map(([k,l])=>btn(l,()=>tab(k),'ds-tab'+(id===k?' active':''))));article.replaceChildren();const fns=[];
 if(id==='sampling'){article.append(e('div','ds-muted','Creator and Personal are saved in Uninodes for each model. Changing manual sampling values switches to Custom until you save again.'));
 for(const [key,label,opts] of [['sampler_name','Sampler',{options:n._dsOptions?.samplers||[]}],['scheduler','Scheduler',{options:n._dsOptions?.schedulers||[]}],['steps','Steps',{step:1}],['cfg','CFG',{step:0.5}],['denoise','Denoise',{step:0.01}],['clip_skip','CLIP skip',{step:1}]])fns.push(addField(cfg,key,label,opts));
 const modeSel=select(cfg.mode||'t2i',[{value:'t2i',label:'T2I'},{value:'i2i',label:'I2I'}]);article.append(field('Mode',modeSel));fns.push(()=>{if(modeSel.value!==currentMode(cfg)){const previous=currentMode(cfg);const prevBag=cfg[previous+'_settings'];for(const key of MODE_SETTINGS[previous])prevBag[key]=structuredClone(cfg[key]);applyModeSettings(cfg,modeSel.value);}else cfg.mode=modeSel.value;});
 }else if(id==='resolution'){for(const [key,label,opts]of [['width','Width',{step:8}],['height','Height',{step:8}],['batch_size','Batch size',{step:1}],['vae_name','VAE',{options:[{value:'Internal',label:'Internal'},{value:'External',label:'External'},...(n._dsOptions?.vaes||[]).map(v=>({value:v,label:v}))]}],['clip_source','CLIP',{options:[{value:'Internal',label:'Auto / embedded'},{value:'Manual',label:'Select encoders'},{value:'External',label:'External socket'}]}]])fns.push(addField(cfg,key,label,opts));
 article.append(e('p','ds-muted','Model-only families can use the left-column encoder selector. For unusual models choose Manual and select a compatible loader + encoder(s).'));
 }else if(id==='loras'){article.append(e('p','ds-muted','Use the LoRA rows on the left to add, reorder, enable, and tune LoRAs. Trigger words are optional.'));const ck=e('label','ds-row');const c=textBox(cfg.apply_profile_prefixes,'checkbox');ck.append(c,e('span','','Apply positive / negative prefixes to prompts'));article.append(ck);fns.push(()=>{cfg.apply_profile_prefixes=c.checked;});
 article.append(e('p','ds-muted','Prefixes can also be edited directly under Model & Profile on the node. They work in Custom mode too when enabled; use Save Creator / Personal to keep per-model presets.'));
 for(const [key,labelText] of [['positive_prefix','Positive prefix'],['negative_prefix','Negative prefix']]){
  const label=e('label','ds-field');label.append(e('span','',labelText));const box=e('textarea');box.rows=3;box.maxLength=12000;box.value=String(cfg[key]||'');label.append(box);article.append(label);
  fns.push(()=>{cfg[key]=box.value;});
 }
 }else if(id==='sockets'){
 article.append(e('p','ds-muted','Existing connected sockets are never removed. ControlNet: connect a ControlNet Apply node through the optional CONDITIONING override inputs.'));
 const list=[['latent','External latent'],['lora_stack','External LoRA stack'],['model','Model override'],['clip','CLIP override'],['vae','VAE override'],['positive_conditioning','Positive CONDITIONING override'],['negative_conditioning','Negative CONDITIONING override'],['init_image','Input image for img2img'],['mask','Mask (for image inpaint)'],['latent_output','Show LATENT output'],['conditioning_outputs','Show CONDITIONING outputs']];
 const controls=[];for(const [key,name]of list){const cb=textBox(corePorts.has(key)||cfg.show_sockets?.[key],'checkbox');if(corePorts.has(key)){cb.disabled=true;cb.title='Core socket always visible';}const row=e('label','ds-row');row.append(cb,e('span','',name));article.append(row);controls.push([key,cb]);}
 const latentOutput=controls.find(([key])=>key==='latent_output')?.[1];const condOutputs=controls.find(([key])=>key==='conditioning_outputs')?.[1];
 function syncOutputDependencies(){if(!latentOutput||!condOutputs)return;latentOutput.checked=condOutputs.checked||Boolean(cfg.show_sockets?.latent_output);latentOutput.disabled=condOutputs.checked;latentOutput.title=condOutputs.checked?'Required to keep conditioning outputs at their original ComfyUI indices':'';}
 condOutputs?.addEventListener('change',syncOutputDependencies);syncOutputDependencies();
 article.append(e('p','ds-muted','Conditioning outputs also show the LATENT output, to preserve ComfyUI output indices. Already connected outputs always remain visible.'));
 fns.push(()=>{cfg.show_sockets??={};for(const [key,cb]of controls){if(key==='latent_output'&&condOutputs?.checked)continue;cfg.show_sockets[key]=cb.checked;}});
 }else if(id==='preview'){article.append(e('p','ds-muted','ComfyUI denoising previews appear while sampling, without retaining a frame history. Final decoded PNGs are temporary until saved.'));
 }
 flush=()=>{for(const fn of fns)fn();}; }
 tab('sampling');}
export function installSampler(n,{root:providedRoot=null,combined=false}={}){if(n._dsInstalled)return;n._dsInstalled=true;n._dsCombined=combined;ensureCSS();if(typeof n.addDOMWidget!=='function'){console.warn('[Direct Sampler] No addDOMWidget; native controls remain.');return;}
 clearLegacyPreview(n);removeNativeDSPreview(n);const root=providedRoot||e('div','ds-root');root.classList.add('ds-root');stopGestures(root);if(!providedRoot){const dom=n.addDOMWidget('ds_studio','custom',root,{serialize:false,hideOnZoom:false,margin:0,getHeight:()=>Math.max(515,n.size?.[1]-80||550),getMinHeight:()=>515,getMaxHeight:()=>1600});dom.serialize=false;}n._dsRoot=root;n._dsConfig=readConfigWithSeedMigration(n);n._dsDisplaySeed=currentImageSeed(n);n._dsResults=Array.isArray(n.properties?.ds_preview_images)?n.properties.ds_preview_images.slice(0,12):[];n._dsResultIndex=0;hideNative(n);nodes.set(String(n.id),n);if(!combined)n.setSize?.([Math.max(900,n.size?.[0]||0),Math.max(700,n.size?.[1]||0)]);
 const oldRemoved=n.onRemoved;n.onRemoved=function(...args){nodes.delete(String(n.id));if(n._dsFrameURL)URL.revokeObjectURL(n._dsFrameURL);return oldRemoved?.apply(this,args);};
 const oldConfigure=n.onConfigure;n.onConfigure=function(...args){const result=oldConfigure?.apply(this,args);n._dsConfig=readConfigWithSeedMigration(n);n._dsDisplaySeed=currentImageSeed(n);n._dsResults=Array.isArray(n.properties?.ds_preview_images)?n.properties.ds_preview_images.slice(0,12):n._dsResults;n._dsManualNext=false;queueMicrotask(()=>{nodes.set(String(n.id),n);hideNative(n);optionalSockets(n);if(!n._dsCombined)resize(n);render(n);restorePreviewState(n);hydrateLoRATriggers(n);if(val(n,'profile_mode')!=='Custom')refreshProfile(n);});return result;};
 optionalSockets(n);render(n);restorePreviewState(n);fetchOutputFolders(n);installVisibilityRestore();loadLoRATriggerLibrary().then(()=>hydrateLoRATriggers(n));const fetchOpts=async()=>{try{const r=await api.fetchApi('/uninodes/sampler/options');const opts=await r.json();if(!r.ok)throw Error(opts.error||'Unable to load options');n._dsOptions=opts;render(n);}catch(err){console.warn('[Direct Sampler] Options:',err);}};fetchOpts();}
startSamplerEvents();
app.registerExtension({name:'uninodes.direct_sampler',async beforeRegisterNodeDef(nodeType,nodeData){if(nodeData.name!==NODE)return;const prev=nodeType.prototype.onNodeCreated;nodeType.prototype.onNodeCreated=function(...args){const result=prev?.apply(this,args);installSampler(this);return result;};}});
