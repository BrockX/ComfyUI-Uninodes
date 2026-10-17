/* Checkpoint Profile Manager V1.5.12 — block-only chained prompt composition.
 * Purely local configuration serialized in blocks_json; custom libraries stored
 * server-side in data/libraries. No package changes to imported library data.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TYPE = 'CPMPromptComposer', PREFIX = 'cpm_block_';
const MAX = 96;
// Fixed, deliberately muted accents: colour coding without a picker.
// Stored as IDs so existing workflows can be opened on future themes.
const FOLDER_COLORS = [
    {id:'blue',label:'Ocean',hex:'#78A9E8'},
    {id:'indigo',label:'Indigo',hex:'#9298E9'},
    {id:'violet',label:'Violet',hex:'#B28CE5'},
    {id:'pink',label:'Rose',hex:'#D887B4'},
    {id:'red',label:'Coral',hex:'#E48589'},
    {id:'orange',label:'Amber',hex:'#E8A16E'},
    {id:'yellow',label:'Gold',hex:'#D6BD70'},
    {id:'lime',label:'Lime',hex:'#ADCA72'},
    {id:'green',label:'Green',hex:'#78C28F'},
    {id:'teal',label:'Teal',hex:'#65BCAA'},
    {id:'cyan',label:'Cyan',hex:'#72BED6'},
    {id:'slate',label:'Slate',hex:'#A4ADB9'}
];
const colorById=id=>FOLDER_COLORS.find(c=>c.id===id)||FOLDER_COLORS[0];
const rgba=(hex,opacity)=>{const s=hex.replace('#','');return `rgba(${parseInt(s.slice(0,2),16)},${parseInt(s.slice(2,4),16)},${parseInt(s.slice(4,6),16)},${opacity})`;};
const inheritedAccent=(b,rows)=>b.type==='folder'?colorById(b.color).hex:(rows.find(r=>r.type==='folder'&&r.id===b.folder_id)?colorById(rows.find(r=>r.id===b.folder_id).color).hex:null);

const get = (n,k)=>n.widgets?.find(w=>w.name===k);
const SOCKET_DEFAULTS={clip:false,conditioning:false};
function socketSettings(n){
    try{const parsed=JSON.parse(get(n,'socket_settings')?.value||'{}');
        return {clip:parsed.clip===true,conditioning:parsed.conditioning===true};
    }catch{return {...SOCKET_DEFAULTS};}
}
function writeSocketSettings(n,next){
    const w=get(n,'socket_settings');if(!w)throw Error('socket_settings widget is missing; restart ComfyUI after installing the update');
    w.value=JSON.stringify(next);graphDirty();
}
function hideInternalWidget(n,key){
    const w=get(n,key);if(!w)return;
    w.type='hidden';w.hidden=true;w.computeSize=()=>[0,-4];w.options??={};
    w.options.hidden=true;w.options.serialize=true;
    for(const p of ['element','inputEl'])if(w[p]?.style)w[p].style.display='none';
}

const uuid = ()=>`b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const graphDirty=()=>app.graph?.setDirtyCanvas(true,true);
const esc = s=>String(s??'');
const connector=(b,pol)=>`${PREFIX}${b.id}_${pol}`;
const textOrEmpty=(s)=>typeof s==='string'?s:'';
const request=async(url,opt)=>{const res=await api.fetchApi(url,opt);const json=await res.json();if(!res.ok)throw Error(json.error||`HTTP ${res.status}`);return json;};
const catalog=async()=>{
    const idx=await request('/uninodes/composer/libraries');
    const all=[];
    const responses=await Promise.all(idx.libraries.map(row=>request(`/uninodes/composer/library?id=${encodeURIComponent(row.id)}`).catch(e=>{
        console.warn('[CPM] Library unavailable:',row.id,e);return null;
    })));
    const folders=new Map(idx.libraries.map(row=>[row.id,row.folder||'']));
    return responses.filter(Boolean).map(lib=>({...lib,folder:folders.get(lib.id)||''}));
};
const libFor=(arr,id)=>arr?.find(x=>x.id===id);
const displayLibrary=lib=>lib.folder?`${lib.folder.replaceAll('/', ' / ')} / ${lib.name}`:lib.name;
const labelFor=(b,arr)=>libFor(arr,b.library_id)?.name||b.library_id||'Library';
const presetsFor=(b,arr)=>libFor(arr,b.library_id)?.entries||[];
const entryFor=(b,arr)=>presetsFor(b,arr).find(x=>x.id===b.preset_id);
const slotDefs=(b,arr)=>entryFor(b,arr)?.variables||{};
const modifierOptions=(def,arr)=>def.type==='text'?[]:libFor(arr,def.library)?.entries||[];
const modifierName=(b,slot,def,arr)=>modifierOptions(def,arr).find(x=>x.id===b.variables?.[slot])?.name||'—';
const mainLibraries=arr=>arr.filter(x=>x.kind!=='modifier');

function normalized(raw){
    let source=[];
    try{source=JSON.parse(raw||'[]');}catch{return [];}
    if(!Array.isArray(source))return [];
    const ids=new Set();const rows=[];
    const legacy=!source.some(b=>b?.type==='main');
    for(const r of source.slice(0,MAX)){
        if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(r.id)||ids.has(r.id))continue;
        ids.add(r.id);
        const type=['main','folder','text','library'].includes(r.type)?r.type:'text';
        if(type==='main')continue; // Compatibility: old anchor has no row in V1.5.12.
        const base={type,id:r.id,name:typeof r.name==='string'?r.name.slice(0,160):(type==='folder'?'Folder':'Block')};
        if(type==='folder'){base.color=colorById(r.color).id;rows.push(base);continue;}
        base.folder_id=typeof r.folder_id==='string'?r.folder_id:null;
        base.enabled=r.enabled!==false;
        base.expose_input=Boolean(r.expose_input);
        if(type==='library'){
            base.library_id=r.library_id||'camera';base.preset_id=r.preset_id||'';
            base.auto_label=r.auto_label!==false;
            base.variables=(r.variables&&typeof r.variables==='object'&&!Array.isArray(r.variables))?{...r.variables}:{};
        }else{
            const old=typeof r.positive_text!=='string'&&typeof r.negative_text!=='string';
            base.positive_text=old?(r.target==='negative'?'':textOrEmpty(r.text)):textOrEmpty(r.positive_text);
            base.negative_text=old?(r.target==='negative'?textOrEmpty(r.text):''):textOrEmpty(r.negative_text);
            // Existing workflows keep their inline editors on upgrade.
            // The switch affects presentation only, never composed text.
            base.show_text_fields=r.show_text_fields!==false;
            base._legacy_target=old?r.target:null;
        }
        if(legacy)base._legacy_placement=r.placement==='suffix'?'suffix':'prefix';
        rows.push(base);
    }
    if(legacy){
        const pref=rows.filter(b=>b._legacy_placement!=='suffix');const suf=rows.filter(b=>b._legacy_placement==='suffix');
        return [...pref,...suf];
    }
    return rows;
}
function savedRows(rows){return rows.map(row=>{
    const b={...row};delete b._legacy_target;delete b._legacy_placement;return b;
});}
const read=n=>normalized(get(n,'blocks_json')?.value);
function save(n,rows){const w=get(n,'blocks_json');if(!w)throw Error('blocks_json missing: restart ComfyUI after update');w.value=JSON.stringify(savedRows(rows));graphDirty();}
function hideConfig(n){hideInternalWidget(n,'blocks_json');hideInternalWidget(n,'socket_settings');}
function removeLegacySockets(n,rows){
    for(let i=(n.inputs?.length||0)-1;i>=0;i--){
        const input=n.inputs[i];
        if(['style_positive','style_negative'].includes(input.name))n.removeInput(i);
        else if(input.name.startsWith(PREFIX)){
            const id=input.name.slice(PREFIX.length), b=rows.find(x=>x.id===id);
            if(b?.type==='text'&&b.expose_input){
                const polarity=b._legacy_target==='negative'?'negative':'positive';
                input.name=connector(b,polarity);
            }
        }
    }
    // Old version's enable_style_prefixes/enable_checkpoint_prefixes widgets do
    // not control anything in V1.5; keep checkpoint control via fixed sockets.
    if(n.widgets)n.widgets=n.widgets.filter(w=>!['enable_style_prefixes','enable_checkpoint_prefixes'].includes(w.name));
}
// The permanent text outputs must come first. This lets unconnected
// CONDITIONING sockets be truly removed from the end without reindexing the
// STRING outputs. This is mirrored in composer_node.py RETURN_TYPES.
const COMPOSER_OUTPUTS=[
    ['positive_text','STRING'], ['negative_text','STRING'],
    ['positive','CONDITIONING'], ['negative','CONDITIONING']
];
function hasLinks(slot){return Boolean(slot?.links?.length);}
function migrationLinks(outputs){
    if(outputs?.[0]?.type!=='CONDITIONING' || outputs?.[2]?.type!=='STRING')return [];
    const oldToNew=[2,3,0,1], changes=[];
    outputs.forEach((slot,i)=>{
        for(const id of slot.links||[])changes.push([id,oldToNew[i]]);
    });
    // Preserve each slot's link references; only their position changes.
    outputs.splice(0,4,outputs[2],outputs[3],outputs[0],outputs[1]);
    return changes;
}
function repairGraphLinks(n,changes){
    if(!changes.length)return 0;
    const links=app.graph?.links;
    let repaired=0;
    for(const [id,newIndex]of changes){
        // ComfyUI uses an ID-indexed object in Node 1.0, but some graph
        // serializers expose arrays or Maps. Match by link ID in all cases.
        const link=links instanceof Map?links.get(id):Array.isArray(links)
            ?links.find(x=>Array.isArray(x)?String(x[0])===String(id):String(x?.id)===String(id))
            :links?.[id];
        if(!link)continue;
        if(Array.isArray(link))link[2]=newIndex;
        else link.origin_slot=newIndex;
        repaired++;
    }
    if(repaired)graphDirty();
    return repaired;
}
function reconcileBaseSockets(n){
    for(const input of n.inputs||[]){
        if(input.name==='checkpoint_positive')input.name='positive';
        if(input.name==='checkpoint_negative')input.name='negative';
    }
    const settings=socketSettings(n);
    const clipIndex=n.inputs?.findIndex(i=>i.name==='clip')??-1;
    if(settings.clip){
        if(clipIndex<0)n.addInput?.('clip','CLIP');
    }else if(clipIndex>=0 && n.inputs[clipIndex].link==null){
        n.removeInput?.(clipIndex);
    }
    // A just-configured legacy workflow may still have conditioning first.
    // Reorder its actual slots as well as the saved slots, preserving links.
    const migrations=migrationLinks(n.outputs);
    repairGraphLinks(n,migrations);
    for(let i=0;i<2;i++){
        if(!n.outputs?.[i])n.addOutput?.(...COMPOSER_OUTPUTS[i]);
        if(n.outputs?.[i]){
            n.outputs[i].name=COMPOSER_OUTPUTS[i][0];
            n.outputs[i].type=COMPOSER_OUTPUTS[i][1];
            n.outputs[i].label=COMPOSER_OUTPUTS[i][0];
        }
    }
    // CONDITIONING slots are a suffix: remove from end only, and keep
    // connected slots plus their preceding slot to maintain stable indices.
    let keep=settings.conditioning?4:2;
    for(let i=2;i<(n.outputs?.length||0);i++){
        if(hasLinks(n.outputs[i]))keep=Math.max(keep,i+1);
    }
    while((n.outputs?.length||0)>keep && typeof n.removeOutput==='function'){
        const last=n.outputs.length-1;
        if(hasLinks(n.outputs[last]))break;
        n.removeOutput(last);
    }
    while((n.outputs?.length||0)<keep && typeof n.addOutput==='function'){
        const [name,type]=COMPOSER_OUTPUTS[n.outputs.length]||[];
        if(!name)break;
        n.addOutput(name,type);
    }
    for(let i=2;i<(n.outputs?.length||0);i++){
        n.outputs[i].name=COMPOSER_OUTPUTS[i][0];
        n.outputs[i].type=COMPOSER_OUTPUTS[i][1];
        n.outputs[i].label=COMPOSER_OUTPUTS[i][0];
        n.outputs[i].hidden=false;
    }
}
function reconcileSockets(n,rows){
    const allowed=new Map();
    for(const b of rows){if(!['text','library'].includes(b.type)||!b.expose_input)continue;
        for(const p of ['positive','negative'])allowed.set(connector(b,p),`${b.name} ${p==='positive'?'+':'−'}`);
    }
    reconcileBaseSockets(n);
    removeLegacySockets(n,rows);
    for(let i=(n.inputs?.length||0)-1;i>=0;i--){
        const inp=n.inputs[i];if(inp?.name?.startsWith(PREFIX)&&!allowed.has(inp.name))n.removeInput(i);
    }
    for(const [name,label] of allowed){
        let input=n.inputs?.find(i=>i.name===name);
        if(!input){n.addInput(name,'STRING');input=n.inputs?.find(i=>i.name===name);}
        if(input){input.type='STRING';input.label=label;}
    }
}
function addRuntime(n,type,name,value,callback,options={}){
    const w=n.addWidget(type,name,value,callback,{...options,serialize:false});
    w._cpmRuntime=true;w.serialize=false;return w;
}
function changed(n,id,fn){
    const rows=read(n);const row=rows.find(x=>x.id===id);if(!row)return;
    const did=fn(row);if(did===false)return;
    save(n,rows);
}
// Nodes 2.0 may intercept the wheel on the Vue node wrapper before the DOM
// widget scrolls. Listen at WINDOW CAPTURE (before node/canvas listeners),
// but only handle wheel gestures inside a Composer block list with overflow.
// Node 1.0 gets the same native-equivalent delta; unrelated canvas and settings
// scrolling remain untouched. Install once, not per row or on every reconcile.
let composerWheelInstalled=false;
function composerWheelScroll(event){
    if(event.ctrlKey)return; // allow Ctrl+wheel zoom gesture
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    const list=path.find?.(node=>node?.classList?.contains?.('cpm-node-scroll'))
        || event.target?.closest?.('.cpm-node-scroll');
    if(!list||list.scrollHeight<=list.clientHeight+1)return;
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?list.clientHeight:1);
    // Avoid accidentally capturing horizontal trackpad scrolling.
    if(!delta||Math.abs(delta)<Math.abs(event.deltaX))return;
    if(event.cancelable)event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    list.scrollTop+=delta;
}
function installComposerWheel(){
    if(composerWheelInstalled||typeof window.addEventListener!=='function')return;
    window.addEventListener('wheel',composerWheelScroll,{capture:true,passive:false});
    composerWheelInstalled=true;
}
// DOM controls are supported by both ComfyUI's legacy canvas and Vue Nodes 2.0.
// The previous canvas-only click handler was interactive only in Node 1.0;
// Vue Nodes 2.0 painted it but did not dispatch the widget.mouse handler.
function stopNodeGesture(element){
    for(const name of ['pointerdown','mousedown','dblclick'])
        element.addEventListener(name,event=>event.stopPropagation());
    return element;
}
function action(label,className,callback){
    const el=h('button',className,label);el.type='button';stopNodeGesture(el);
    el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();callback(event);});
    return el;
}
// These are *starting* dimensions, not content-derived minima. The user can
// resize the node in either renderer; overflowing blocks stay inside the list.
const COMPOSER_START_SIZE=[650,540];
const COMPOSER_MIN_SIZE=[320,240];
function setComposerSize(n,width,height){
    const w=Math.max(COMPOSER_MIN_SIZE[0],Math.round(width));
    const h=Math.max(COMPOSER_MIN_SIZE[1],Math.round(height));
    if(!Number.isFinite(w)||!Number.isFinite(h))return;
    if(Math.abs((n.size?.[0]||0)-w)<1&&Math.abs((n.size?.[1]||0)-h)<1)return;
    n.setSize?.([w,h]);
    n._cpmComposerWidget?.triggerDraw?.();
    graphDirty();
}
// A small DOM grip also works when the native canvas resize handle is covered
// by the HTML overlay (notably in Nodes 2.0). Delta is in screen pixels, while
// setSize expects graph pixels: account for the current canvas zoom.
function composerResizeGrip(n){
    const grip=h('div','cpm-node-resize-grip');
    grip.title='Drag to resize Prompt Composer (arrow keys also resize)';
    grip.setAttribute('role','button');
    grip.setAttribute('tabindex','0');
    grip.setAttribute('aria-label','Resize Prompt Composer');
    stopNodeGesture(grip);
    grip.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        const id=event.pointerId;
        const startX=event.clientX,startY=event.clientY;
        const startW=n.size?.[0]||COMPOSER_START_SIZE[0];
        const startH=n.size?.[1]||COMPOSER_START_SIZE[1];
        const zoom=Math.max(0.05,Number(app.canvas?.ds?.scale)||1);
        const move=e=>{
            if(e.pointerId!==id)return;
            e.preventDefault();e.stopPropagation();
            setComposerSize(n,startW+(e.clientX-startX)/zoom,startH+(e.clientY-startY)/zoom);
        };
        const finish=e=>{
            if(e.pointerId!==id)return;
            window.removeEventListener('pointermove',move,true);
            window.removeEventListener('pointerup',finish,true);
            window.removeEventListener('pointercancel',finish,true);
            e.stopPropagation();
        };
        window.addEventListener('pointermove',move,{capture:true,passive:false});
        window.addEventListener('pointerup',finish,true);
        window.addEventListener('pointercancel',finish,true);
    });
    grip.addEventListener('keydown',event=>{
        const delta={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key];
        if(!delta)return;
        event.preventDefault();event.stopPropagation();
        setComposerSize(n,(n.size?.[0]||COMPOSER_START_SIZE[0])+delta[0],
            (n.size?.[1]||COMPOSER_START_SIZE[1])+delta[1]);
    });
    return grip;
}
function domFolder(n,b,rows){
    const accent=colorById(b.color).hex;
    const count=rows.filter(x=>x.folder_id===b.id).length;
    const root=h('div','cpm-node-folder');root.style.setProperty('--cpm-accent',accent);
    root.style.background=rgba(accent,0.20);root.style.borderColor=rgba(accent,0.44);
    const closed=(n.properties?.cpm_collapsed_folders||[]).includes(b.id);
    const chevron=h('span','cpm-node-chevron',closed?'▸':'▾');
    root.append(chevron,h('strong','cpm-node-folder-label',b.name.toLocaleUpperCase()),h('span','cpm-node-count',String(count)));
    root.title=closed?'Expand folder':'Collapse folder';
    root.addEventListener('click',()=>{
        n.properties??={};const ids=new Set(n.properties.cpm_collapsed_folders||[]);
        if(ids.has(b.id))ids.delete(b.id);else ids.add(b.id);
        n.properties.cpm_collapsed_folders=[...ids];graphDirty();reconcile(n);
    });
    return root;
}
function domRow(n,b,rows,library){
    const accent=inheritedAccent(b,rows);
    const root=h('div','cpm-node-block'+(b.folder_id?' nested':'')+(b.enabled?'':' disabled'));
    if(accent){root.style.setProperty('--cpm-accent',accent);root.style.background=rgba(accent,b.enabled?0.12:0.055);root.style.borderColor=rgba(accent,b.enabled?0.4:0.23);}
    const top=h('div','cpm-node-line'+(b.type==='library'?' cpm-node-library-line':''));
    const handle=h('span','cpm-node-drag-handle','⋮⋮');
    handle.draggable=true;handle.title='Drag to reorder';
    stopNodeGesture(handle);
    handle.addEventListener('dragstart',ev=>{ev.dataTransfer?.setData('text/plain',b.id);if(ev.dataTransfer)ev.dataTransfer.effectAllowed='move';});
    handle.addEventListener('dragend',()=>root.classList.remove('cpm-drag-target'));
    top.append(handle);
    const toggle=action(b.enabled?'ON':'OFF','cpm-node-toggle',()=>{
        changed(n,b.id,x=>{x.enabled=!x.enabled;});reconcile(n);
    });
    toggle.setAttribute('aria-label',`${b.enabled?'Disable':'Enable'} ${b.name}`);
    toggle.setAttribute('aria-pressed',String(b.enabled));
    top.append(toggle);
    const title=h('span','cpm-node-block-title',b.name);title.title=b.name;top.append(title);
    if(b.type==='library'){
        const presets=presetsFor(b,library);
        const active=presets.find(x=>x.id===b.preset_id);
        const button=action('', 'cpm-node-picker',ev=>choosePreset(n,b,ev));
        button.title=active?.name||b.preset_id||'Choose a preset';
        button.append(h('span','cpm-node-picker-label',active?.name||b.preset_id||'Select preset'),h('span','cpm-node-picker-arrow','▾'));
        top.append(button);
        const edit=action('✎','cpm-node-library-edit',()=>openSettings(n,b.id,{tab:'libraries',libraryId:b.library_id,presetId:b.preset_id}));
        edit.title=`Edit ${labelFor(b,library)} library preset in Settings`;
        edit.setAttribute('aria-label',`Edit ${b.name} library`);
        top.append(edit);
        for(const [slot,def] of Object.entries(slotDefs(b,library))){
            if(def.type==='text'){
                const field=h('label','cpm-node-free-text');
                field.title=`${b.name} · ${def.label||slot} (optional free text)`;
                field.append(h('span','cpm-node-free-text-label',def.label||slot));
                const input=h('input','cpm-node-free-text-input');
                input.type='text';input.maxLength=2000;input.spellcheck=false;
                input.value=typeof b.variables?.[slot]==='string'?b.variables[slot]:'';
                input.placeholder=def.placeholder||'Optional…';
                input.setAttribute('aria-label',`${b.name} ${def.label||slot} optional free text`);
                stopNodeGesture(input);
                input.addEventListener('keydown',e=>e.stopPropagation());
                // Do not reconcile/rebuild on each keystroke: keep caret/focus.
                input.addEventListener('input',()=>changed(n,b.id,x=>{
                    if(x.variables?.[slot]===input.value)return false;
                    x.variables={...(x.variables||{}),[slot]:input.value};
                }));
                field.append(input);top.append(field);
            }else{
                const chosen=modifierName(b,slot,def,library);
                const sub=action('', 'cpm-node-modifier',ev=>chooseModifier(n,b,slot,def,ev));
                sub.title=`${def.label||slot}: ${chosen}`;
                sub.setAttribute('aria-label',`${b.name} ${def.label||slot}: ${chosen}`);
                sub.append(h('span','cpm-node-modifier-name',def.label||slot),
                           h('span','cpm-node-modifier-value',chosen),
                           h('span','cpm-node-picker-arrow','▾'));
                top.append(sub);
            }
        }
    }else{
        top.append(action(b.show_text_fields===false?'Text in settings':'Edit text below','cpm-node-edit',()=>openSettings(n,b.id)));
    }
    root.append(top);
    if(b.type==='text'&&b.show_text_fields!==false){
        const inputs=h('div','cpm-node-text-inputs');
        for(const polarity of ['positive','negative']){
            const line=h('label','cpm-node-text-line');
            line.append(h('span','cpm-node-text-caption',`${b.name} · ${polarity==='positive'?'+':'−'}`));
            const field=h('textarea','cpm-node-textarea');field.rows=1;
            field.value=b[polarity+'_text']||'';field.spellcheck=false;
            field.setAttribute('aria-label',`${b.name} ${polarity} text`);
            stopNodeGesture(field);
            field.addEventListener('keydown',e=>e.stopPropagation());
            field.addEventListener('input',()=>changed(n,b.id,x=>{
                if(x[polarity+'_text']===field.value)return false;
                x[polarity+'_text']=field.value;
            }));
            line.append(field);inputs.append(line);
        }
        root.append(inputs);
    }
    return root;
}
function reorderOnNode(n,dragId,targetId,intoFolder=false,atEnd=false){
    const rows=read(n),moving=rows.find(b=>b.id===dragId),target=rows.find(b=>b.id===targetId);
    if(!moving||(!atEnd&&!target)||dragId===targetId)return;
    const chunk=moving.type==='folder'?rows.filter(r=>r.id===dragId||r.folder_id===dragId):[moving];
    if(target&&chunk.some(r=>r.id===targetId))return;
    const others=rows.filter(r=>!chunk.includes(r));
    if(moving.type==='folder'){if(intoFolder)return;moving.folder_id=null;}
    else moving.folder_id=atEnd?null:(intoFolder&&target.type==='folder'?target.id:(target?.folder_id||null));
    let index=others.length;
    if(!atEnd){if(intoFolder&&target.type==='folder')index=others.reduce((last,row,i)=>row.id===target.id||row.folder_id===target.id?i+1:last,0);
      else index=others.findIndex(r=>r.id===targetId);
      if(index<0)index=others.length;}
    others.splice(index,0,...chunk);save(n,others);reconcile(n);
}
function enableNodeDrop(n,element,targetId,intoFolder=false,atEnd=false){
    element.addEventListener('dragover',ev=>{ev.preventDefault();if(ev.dataTransfer)ev.dataTransfer.dropEffect='move';element.classList.add('cpm-drag-target');});
    element.addEventListener('dragleave',()=>element.classList.remove('cpm-drag-target'));
    element.addEventListener('drop',ev=>{ev.preventDefault();ev.stopPropagation();element.classList.remove('cpm-drag-target');const dragId=ev.dataTransfer?.getData('text/plain');if(dragId)reorderOnNode(n,dragId,targetId,intoFolder,atEnd);});
}
function refreshDOM(n,rows,library){
    const root=n._cpmComposerElement;if(!root)return;
    const previousScroll=n._cpmList?.scrollTop||0;
    const shell=h('div','cpm-node-shell');
    const suiteHead=h('div','cpm-node-suite-head');
    const suiteIcon=h('span','cpm-node-suite-icon','▤');suiteIcon.dataset.icon='composer';
    const suiteTitles=h('div','cpm-node-suite-titles');
    suiteTitles.append(h('strong','','PROMPT COMPOSER'),h('span','','Blocks · Presets · Folders'));
    suiteHead.append(suiteIcon,suiteTitles);
    const settings=action('⚙','cpm-node-settings',()=>openSettings(n));settings.title='Settings';
    suiteHead.append(settings);shell.append(suiteHead);
    const list=h('div','cpm-node-scroll');n._cpmList=list;
    list.tabIndex=0;list.setAttribute('role','region');
    list.setAttribute('aria-label','Prompt Composer blocks (scroll to see more)');
    const collapsed=new Set(n.properties?.cpm_collapsed_folders||[]);
    for(const b of rows){
        if(b.folder_id&&collapsed.has(b.folder_id))continue;
        const item=b.type==='folder'?domFolder(n,b,rows):domRow(n,b,rows,library);
        enableNodeDrop(n,item,b.id,b.type==='folder');list.append(item);
    }
    const end=h('div','cpm-node-drop-end','Drop here to move to the end');
    enableNodeDrop(n,end,null,false,true);list.append(end);
    shell.append(list);root.replaceChildren(shell,composerResizeGrip(n));
    list.scrollTop=previousScroll;
    // ComfyUI owns the widget viewport. Content never sets the node minimum.
}

function ensureDOM(n){
    if(n._cpmComposerWidget&&n.widgets?.includes(n._cpmComposerWidget))return;
    ensureCSS();const element=h('div','cpm-node-layout');n._cpmComposerElement=element;
    if(typeof n.addDOMWidget!=='function')throw Error('ComfyUI addDOMWidget API not available; update ComfyUI frontend.');
    const widget=n.addDOMWidget('cpm_composer_layout','custom',element,{
        serialize:false,hideOnZoom:false,margin:0,
        // Percentage height participates in ComfyUI's flex widget layout in
        // both canvas Nodes 1.0 and Vue Nodes 2.0. A fixed minimum is crucial:
        // deriving it from node.size or the number of blocks prevents shrinking.
        getHeight:()=> '100%',
        getMinHeight:()=>120,
        afterResize:()=>widget.triggerDraw?.()
    });
    widget.serialize=false;widget._cpmRuntime=true;n._cpmComposerWidget=widget;
    stopNodeGesture(element);
    installComposerWheel();
}

function choosePreset(n,b,ev){
    const options=presetsFor(b,n._cpmCatalog);
    if(!options.length)return;
    showChoices(n,b,ev,options,`Search ${b.name}…`,opt=>{
        changed(n,b.id,x=>{x.preset_id=opt.id;x.variables={};});reconcile(n);
    });
}
function chooseModifier(n,b,slot,def,ev){
    const choices=modifierOptions(def,n._cpmCatalog);
    showChoices(n,b,ev,[{id:'',name:'None (no insertion)'},...choices],`Search ${def.label||slot}…`,opt=>{
        changed(n,b.id,x=>{x.variables={...(x.variables||{}),[slot]:opt.id};});reconcile(n);
    });
}
function showChoices(n,b,ev,options,placeholder,onPick){
    const ov=h('div','cpm-picker');
    ov.style.left=`${Math.min(window.innerWidth-300,Math.max(12,ev.clientX||240))}px`;
    ov.style.top=`${Math.min(window.innerHeight-380,Math.max(12,ev.clientY||120))}px`;
    const filter=h('input');filter.placeholder=placeholder;
    const list=h('div','cpm-picker-list');
    const close=()=>{ov.remove();document.removeEventListener('pointerdown',outside,true);};
    const outside=e=>{if(!ov.contains(e.target))close();};
    const render=()=>{list.replaceChildren();const q=filter.value.toLowerCase();for(const opt of options.filter(x=>x.name.toLowerCase().includes(q)).slice(0,80)){
        const pick=btn(opt.name,()=>{onPick(opt);close();});list.append(pick);
    }};
    filter.addEventListener('input',render);ov.append(filter,list);document.body.append(ov);render();
    setTimeout(()=>document.addEventListener('pointerdown',outside,true),0);filter.focus();
}
function reconcile(n){
    hideConfig(n);const rows=read(n);reconcileSockets(n,rows);
    // One persistent DOM widget instead of removing and re-adding transient
    // custom canvas widgets. This avoids stale Vue registrations/mouse handlers.
    for(const w of [...(n.widgets||[])]){
        if(!w._cpmRuntime||w===n._cpmComposerWidget)continue;
        w.onRemove?.();const i=n.widgets.indexOf(w);if(i>=0)n.widgets.splice(i,1);
    }
    ensureDOM(n);
    // Set a useful size exactly once on creation. Never expand the node on
    // catalog fetch, adding blocks, changing presets, or reopening a workflow:
    // doing so overrides the user's manual resize. Rows wrap and scroll.
    if(!n._cpmComposerSized){
        n._cpmComposerSized=true;
        setComposerSize(n,Math.max(n.size?.[0]||0,COMPOSER_START_SIZE[0]),
            Math.max(n.size?.[1]||0,COMPOSER_START_SIZE[1]));
    }
    refreshDOM(n,rows,n._cpmCatalog||[]);
    n._cpmComposerWidget?.triggerDraw?.();
    graphDirty();
    if(!n._cpmCatalog&&!n._cpmLoading){
        n._cpmLoading=true;
        catalog().then(all=>{n._cpmCatalog=all;reconcile(n);})
            .catch(e=>console.warn('[CPM] Unable to fetch preset names',e))
            .finally(()=>n._cpmLoading=false);
    }
}
function h(tag,klass,text){const e=document.createElement(tag);if(klass)e.className=klass;if(text!==undefined)e.textContent=text;return e;}
function btn(text,fn,klass=''){const e=h('button',klass,text);e.type='button';e.addEventListener('click',fn);return e;}
function fld(label,value,onChange,multi=false){const l=h('label','cpm-field',label);const x=h(multi?'textarea':'input');if(!multi)x.type='text';else x.rows=3;x.value=value||'';x.addEventListener('input',()=>onChange(x.value));l.append(x);return l;}
function select(label,choices,value,cb){const l=h('label','cpm-field',label);const s=h('select');for(const [v,t]of choices){const opt=h('option','',t);opt.value=v;s.append(opt);}s.value=value;s.addEventListener('change',()=>cb(s.value));l.append(s);return l;}
function check(label,value,cb){const l=h('label','cpm-check');const x=h('input');x.type='checkbox';x.checked=value;x.addEventListener('change',()=>cb(x.checked));l.append(x,document.createTextNode(label));return l;}
let cssDone=false;
function ensureCSS(){if(cssDone)return;cssDone=true;const s=h('style');s.textContent=`
.cpm-overlay{position:fixed;inset:0;z-index:100000;background:#070b12c9;display:flex;align-items:center;justify-content:center;padding:16px;color:#ecf1fc;font:13px system-ui,sans-serif}
.cpm-modal{width:min(1020px,96vw);height:min(760px,93vh);max-height:93vh;min-height:0;display:flex;flex-direction:column;background:#1b2230;border:1px solid #4b5870;border-radius:12px;box-shadow:0 22px 80px #000a;overflow:hidden}
.cpm-modal header,.cpm-modal footer{padding:13px 17px;display:flex;align-items:center;gap:8px;background:#202a3b}.cpm-modal header{border-bottom:1px solid #354153;justify-content:space-between}.cpm-modal footer{border-top:1px solid #354153;flex-wrap:wrap;justify-content:flex-end}
.cpm-modal h2{font-size:17px;margin:0}.cpm-modal button,.cpm-picker button{background:#35455c;border:1px solid #4b5c75;color:#e8effe;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px}.cpm-modal button:hover,.cpm-picker button:hover{background:#4d6180}.cpm-modal button.cpm-primary{background:#4469b6}.cpm-modal button.cpm-danger{background:#56333d}
.cpm-modal button:disabled{opacity:.35}.cpm-layout{display:grid;grid-template-columns:minmax(230px,34%) minmax(360px,1fr);min-height:0;overflow:hidden;flex:1}
.cpm-sidebar{padding:14px;display:flex;flex-direction:column;gap:9px;min-height:0;border-right:1px solid #394659;overflow:hidden;background:#171f2d}.cpm-sidebar-list{min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:4px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:3px 6px 4px 0;scrollbar-width:thin;scrollbar-color:#63748e #192334}.cpm-sidebar-help{flex:0 0 auto}.cpm-sidebar-root{flex:0 0 auto;width:100%}.cpm-detail{padding:20px;display:flex;min-height:0;flex-direction:column;gap:14px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}.cpm-caption{font-size:12px;color:#9eafc7;line-height:1.5}
.cpm-socket-panel{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid #39485d;border-radius:8px;background:#1b2a3d}.cpm-socket-panel strong{font-size:12px}.cpm-socket-panel .cpm-check{margin:0}.cpm-socket-panel .cpm-caption{margin:2px 0 0;font-size:11px}
.cpm-sideitem{display:flex;flex:0 0 auto;align-items:center;gap:8px;padding:10px 9px;border-radius:7px;cursor:pointer;min-height:41px;outline:1px solid transparent}.cpm-sideitem:hover{background:#283449}.cpm-sideitem.active{background:#2b4368;outline:1px solid #4b78bc}.cpm-sideitem.dragover{border-top:2px solid #79a8f3}.cpm-sideitem.folder{font-weight:700;background:#243148}.cpm-sideitem.folder-drop{outline:2px dashed #8bb6ff}.cpm-sideitem .handle{opacity:.45;cursor:grab;font-size:13px}.cpm-sideitem .name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpm-color-palette{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:6px 0 10px}.cpm-modal button.cpm-color-swatch{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;min-width:0;padding:8px 3px 6px;background:#222d3d;border:1px solid #4c596d;border-radius:8px;color:#b8c5d9;font-size:10px}.cpm-modal button.cpm-color-swatch.selected{border-color:#ecf2ff;box-shadow:0 0 0 1px #ecf2ff5c;background:#33425a;color:#fff}.cpm-modal button.cpm-color-swatch:hover{background:#3a4a60}.cpm-color-dot{width:23px;height:23px;border-radius:7px;border:1px solid #ffffff50;box-sizing:border-box}.cpm-field{display:flex;flex-direction:column;gap:6px;color:#bdcbe0;font-size:12px}.cpm-field input,.cpm-field textarea,.cpm-field select,.cpm-picker input{background:#121c2a;color:#f5f7fa;border:1px solid #4c5d75;border-radius:6px;padding:9px;font:13px system-ui,sans-serif;box-sizing:border-box;width:100%}.cpm-field textarea{min-height:75px;resize:vertical}.cpm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cpm-check{display:flex;align-items:center;gap:8px;font-size:12px;color:#e4e9f4}.cpm-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}.cpm-picker{position:fixed;z-index:100005;min-width:260px;width:320px;max-height:360px;overflow:auto;background:#1d2736;box-shadow:0 12px 40px #000b;border:1px solid #506080;border-radius:10px;padding:10px}.cpm-picker-list{display:flex;flex-direction:column;gap:3px;margin-top:7px}.cpm-picker button{text-align:left;width:100%}

/* Actual interactive DOM controls, shared across Nodes 1.0 and 2.0. */
.cpm-node-layout{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:2px 7px 4px;color:#ecf0f9;font:12px system-ui,sans-serif;overflow:visible;user-select:none}
.cpm-node-layout *{box-sizing:border-box}
.cpm-node-suite-head{display:flex;align-items:center;gap:9px;min-height:39px;padding:4px 10px;background:#282f3b;border:1px solid #425067;border-radius:9px;color:#eef2fc}
.cpm-node-suite-icon{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border:1px solid #6984a9;border-radius:9px;background:#30435e;color:#a6c8ff;font-size:19px;font-weight:700}
.cpm-node-suite-titles{display:flex;flex-direction:column;gap:2px;min-width:0}
.cpm-node-suite-titles strong{font-size:11px;font-weight:800;letter-spacing:.2px}
.cpm-node-suite-titles span{font-size:10px;color:#9facbf}

.cpm-node-folder{height:29px;flex-shrink:0;display:flex;align-items:center;gap:8px;border-radius:7px;border:1px solid #526075;border-left:4px solid var(--cpm-accent,#78a9e8);padding:0 10px}
.cpm-node-folder-label{flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;color:#f1f3fb;font-size:11px;font-weight:700}
.cpm-node-chevron{font-size:11px;color:var(--cpm-accent,#78a9e8)}
.cpm-node-count{color:var(--cpm-accent,#78a9e8);font-size:11px;margin-right:3px}
.cpm-node-block{min-height:45px;border-radius:9px;border:1px solid #3a4557;background:#282f3b;position:relative;padding:4px 7px 4px 11px;display:flex;flex-direction:column;gap:7px}
.cpm-node-block::before{content:'';position:absolute;left:1px;top:8px;bottom:8px;width:3px;border-radius:4px;background:var(--cpm-accent,#7aaac7);opacity:.9}
.cpm-node-block.nested{margin-left:11px}
.cpm-node-block.disabled{opacity:.66}
.cpm-node-line{min-height:35px;display:flex;align-items:center;gap:7px;min-width:0}.cpm-node-library-line{flex-wrap:wrap}
.cpm-node-layout button{font:inherit;cursor:pointer;color:#e7effc;outline-offset:2px}
.cpm-node-layout button:hover{filter:brightness(1.14)}
.cpm-node-toggle{border:1px solid color-mix(in srgb,var(--cpm-accent,#70b9a1) 50%,#565d73);border-radius:18px;min-width:52px;height:24px;background:color-mix(in srgb,var(--cpm-accent,#70b9a1) 23%,#26303b);font-size:11px!important;font-weight:700!important;flex-shrink:0}
.cpm-node-block.disabled .cpm-node-toggle{background:#353b47;color:#afb8c9;border-color:#555f6e}
.cpm-node-block-title{font-size:12px;font-weight:600;flex:1 1 95px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;min-width:0}
.cpm-node-picker,.cpm-node-edit{background:color-mix(in srgb,var(--cpm-accent,#8da2c4) 10%,#313a4a);border:1px solid color-mix(in srgb,var(--cpm-accent,#8da2c4) 38%,#485365);border-radius:7px;height:29px;min-width:0;flex:0 1 44%;padding:0 8px;display:flex;align-items:center;gap:8px;text-align:left;font-size:12px!important}
.cpm-node-library-line .cpm-node-picker{flex:1 1 150px;min-width:110px;max-width:240px}
.cpm-node-library-edit{height:25px;min-width:26px;flex:0 0 26px;border:1px solid #4c5b70;border-radius:6px;background:#29384c;padding:0 5px;font-size:14px!important;color:#aec8ea!important}
.cpm-node-modifier{background:color-mix(in srgb,var(--cpm-accent,#8da2c4) 8%,#2e3643);border:1px solid color-mix(in srgb,var(--cpm-accent,#8da2c4) 35%,#465267);border-radius:6px;height:25px;min-width:0;flex:0 0 112px;max-width:148px;display:flex;align-items:center;gap:4px;padding:0 6px;font-size:10px!important;white-space:nowrap}
.cpm-node-modifier-name{font-size:9px;opacity:.7;overflow:hidden;text-overflow:ellipsis;max-width:52px}
.cpm-node-free-text{height:25px;display:flex;align-items:center;gap:5px;flex:0 1 180px;min-width:130px;max-width:240px;border:1px solid color-mix(in srgb,var(--cpm-accent,#8da2c4) 35%,#465267);background:color-mix(in srgb,var(--cpm-accent,#8da2c4) 8%,#2e3643);border-radius:6px;padding:0 5px;user-select:none}
.cpm-node-free-text-label{font-size:9px;opacity:.74;white-space:nowrap;max-width:64px;overflow:hidden;text-overflow:ellipsis}
.cpm-node-free-text-input{background:transparent!important;border:0!important;outline:none!important;color:#eef3fe!important;font:11px system-ui,sans-serif!important;width:100%;min-width:0;height:21px;padding:1px 2px!important;user-select:text}
.cpm-node-free-text-input::placeholder{color:#8d9bae;opacity:.7}
.cpm-node-free-text:focus-within{border-color:var(--cpm-accent,#96b4e6)}
.cpm-node-modifier-name::after{content:':'}.cpm-node-modifier-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:right;font-weight:600;font-size:10px}
.cpm-node-picker-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpm-node-picker-arrow{font-size:10px;color:#aabdd5}
.cpm-node-edit{justify-content:center;white-space:nowrap;font-size:11px!important;color:#b6c4d9!important}
.cpm-node-text-inputs{display:flex;flex-direction:column;gap:5px;padding:0 0 3px}
.cpm-node-text-line{display:grid;grid-template-columns:minmax(70px,27%) 1fr;align-items:center;gap:8px;min-width:0;user-select:none}
.cpm-node-text-caption{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#aebbd0}
.cpm-node-textarea{resize:none;display:block;width:100%;height:39px;min-height:39px;border-radius:7px;border:1px solid #4b576b;background:#202631;color:#f3f4f8;padding:7px 9px;font:12px system-ui,sans-serif;outline:none;user-select:text}
.cpm-node-textarea:focus{border-color:#8aa6d0}
.cpm-node-settings{width:100%;height:33px;flex-shrink:0;background:#2a323d;border:1px solid #4b5769;border-radius:7px;font-size:12px!important;font-weight:600!important;text-align:center;margin-top:2px}

/* The Library Manager lives in the same Settings dialog, using the
   standalone editor served by ComfyUI; its document is same-origin. */
.cpm-tabs{display:flex;align-items:center;gap:5px;margin-left:auto}
.cpm-modal button.cpm-tab{padding:7px 12px;background:transparent;border:1px solid transparent;color:#aabbd2}
.cpm-modal button.cpm-tab.active{color:#f0f5ff;background:#304467;border-color:#566e95}
.cpm-library-pane{flex:1;min-height:0;display:flex;flex-direction:column;background:#0f1521}
.cpm-library-note{flex:0 0 auto;padding:7px 13px;border-bottom:1px solid #324056;color:#a8b8cd;font-size:11px}
.cpm-library-frame{display:block;border:0;flex:1;min-height:0;width:100%;background:#0f1521}

/* Uninodes Composer studio: fixed scroll region and header settings action */
/* The DOM widget requests 100% of the ComfyUI-allocated body with a small
   independent minimum. The list is the ONLY scrolling region. Never set
   the root height from node.size: LiteGraph would treat it as a minimum. */
.cpm-node-layout{position:relative;width:100%;min-width:0;max-width:100%;height:100%!important;min-height:0;max-height:100%!important;overflow:hidden!important;padding:5px!important;background:#1e2532;border:1px solid #40526a;border-radius:12px;display:flex;flex-direction:column}
.cpm-node-shell{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;height:100%;max-height:100%;overflow:hidden;gap:9px}
.cpm-node-scroll{flex:1 1 auto;min-width:0;min-height:0;max-height:100%;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#7587a5 #1e2532;display:flex;flex-direction:column;gap:6px;padding:2px 5px 16px 2px;overscroll-behavior:contain;touch-action:pan-y}
.cpm-node-resize-grip{position:absolute;right:0;bottom:0;z-index:2;width:23px;height:23px;cursor:nwse-resize;touch-action:none;border-bottom-right-radius:11px;background:linear-gradient(135deg,transparent 51%,#9cafca 52%,#9cafca 57%,transparent 58%,transparent 68%,#9cafca 69%,#9cafca 74%,transparent 75%);opacity:.8}
.cpm-node-resize-grip:hover,.cpm-node-resize-grip:focus-visible{opacity:1;background-color:#394e6b;outline:1px solid #9cafca;outline-offset:-2px}
/* Flex children otherwise shrink to their min-height in Nodes 1.0, while
   textarea children do not: the text boxes then overpaint following rows. */
.cpm-node-scroll>.cpm-node-block,.cpm-node-scroll>.cpm-node-folder{flex:0 0 auto;min-height:max-content}
.cpm-node-block:has(.cpm-node-text-inputs){flex-shrink:0!important}
.cpm-node-text-inputs{flex:0 0 auto;min-width:0}
.cpm-node-text-line{grid-template-columns:minmax(70px,27%) minmax(0,1fr);min-height:39px;width:100%}
.cpm-node-textarea{min-width:0;max-width:100%;box-sizing:border-box}
.cpm-node-suite-head{flex:0 0 auto;background:#293648;border-color:#40556f}
.cpm-node-suite-head .cpm-node-settings{margin-left:auto;width:33px;height:30px;border:1px solid #566d8a;background:#334761;padding:0;border-radius:7px;display:grid;place-items:center;font-size:15px!important}
.cpm-node-drag-handle{flex:none;cursor:grab;user-select:none;color:#9eb5d8;font-size:15px;line-height:1.4;padding:4px 2px}
.cpm-node-drag-handle:active{cursor:grabbing}
.cpm-node-folder{cursor:pointer;user-select:none}
.cpm-node-folder.cpm-drag-target,.cpm-node-block.cpm-drag-target{outline:2px dashed #94b8ef}
.cpm-node-drop-end,.cpm-sidebar-end-drop{flex-shrink:0;padding:9px;border:1px dashed #526783;border-radius:7px;text-align:center;color:#91a8c7;font-size:10px}
.cpm-node-drop-end.cpm-drag-target,.cpm-sidebar-end-drop.dragover{border-color:#94b8ef;color:#eaf3ff;background:#38527377}

@media(max-width:720px){.cpm-layout{grid-template-columns:1fr;grid-template-rows:minmax(155px,38%) minmax(0,1fr);min-height:0}.cpm-sidebar{border-right:0;border-bottom:1px solid #394659;padding:10px}.cpm-detail{min-height:0;padding:14px}.cpm-grid{grid-template-columns:1fr}}
`;document.head.append(s);}
function openSettings(n,initialSelection,options={}){
    ensureCSS();const draft=read(n).map(b=>({...b}));let available=n._cpmCatalog||[];
    const socketDraft={...socketSettings(n)};
    let selected=(initialSelection&&draft.some(x=>x.id===initialSelection)?initialSelection:null)||draft.find(x=>x.type==='library')?.id||draft[0]?.id||'';
    const ov=h('div','cpm-overlay'),modal=h('div','cpm-modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    const top=h('header');top.append(h('h2','','Prompt Composer — Settings'));
    const tabs=h('div','cpm-tabs');
    const layoutTab=btn('Blocks & Folders',()=>setTab('blocks'),'cpm-tab');
    const librariesTab=btn('Library Manager',()=>setTab('libraries'),'cpm-tab');
    tabs.append(layoutTab,librariesTab);top.append(tabs,btn('✕',close));
    const layout=h('div','cpm-layout'),left=h('nav','cpm-sidebar'),right=h('section','cpm-detail'),footer=h('footer');
    const manager=h('div','cpm-library-pane');
    manager.append(h('div','cpm-library-note','Library edits save directly to JSON (with backups). Composer layout changes still require Apply on the Blocks tab.'));
    const iframe=h('iframe','cpm-library-frame');iframe.title='Installed Preset Library Manager';
    manager.append(iframe);
    layout.append(left,right);modal.append(top,layout,manager,footer);ov.append(modal);document.body.append(ov);
    let libraryDirty=false,iframeLoaded=false;
    const urlFor=(libraryId,presetId)=>'/uninodes/composer/preset-editor?embedded=1'
        +(libraryId?'&library='+encodeURIComponent(libraryId):'')
        +(presetId?'&preset='+encodeURIComponent(presetId):'');
    function setTab(tab,libraryId,presetId){
        const showManager=tab==='libraries';
        layout.style.display=showManager?'none':'';
        footer.style.display=showManager?'none':'';
        manager.style.display=showManager?'flex':'none';
        layoutTab.classList.toggle('active',!showManager);
        librariesTab.classList.toggle('active',showManager);
        if(showManager&&(!iframeLoaded||libraryId)){
            if(libraryDirty&&!window.confirm?.('Discard unsaved library edits?'))return;
            iframe.src=urlFor(libraryId,presetId);iframeLoaded=true;libraryDirty=false;
        }
    }
    const receive=e=>{
        if(e.source!==iframe.contentWindow||((typeof location!=='undefined')&&e.origin!==location.origin))return;
        if(e.data?.type==='cpm-library-dirty')libraryDirty=Boolean(e.data.dirty);
        if(e.data?.type==='cpm-library-saved'){
            libraryDirty=false;
            catalog().then(x=>{
                available=x;render();
                const nodes=new Set([n,...(app.graph?._nodes||[]).filter(node=>
                    node.type===TYPE||node.comfyClass===TYPE||Boolean(node._cpmComposerElement))]);
                for(const node of nodes){node._cpmCatalog=x;reconcile(node);}
                if(typeof CustomEvent!=='undefined')window.dispatchEvent?.(
                    new CustomEvent('cpm:libraries-changed',{detail:{id:e.data.id}}));
            }).catch(err=>{msg.textContent=`Could not refresh libraries: ${err.message}`;});
        }
    };
    window.addEventListener?.('message',receive);
    const msg=h('span','cpm-caption');
    function close(){
        if(libraryDirty&&!window.confirm?.('Discard unsaved library edits?'))return;
        ov.remove();document.removeEventListener('keydown',onKey);
        window.removeEventListener?.('message',receive);
    }
    function onKey(ev){if(ev.key==='Escape')close();}
    document.addEventListener('keydown',onKey);ov.addEventListener('mousedown',ev=>{if(ev.target===ov)close();});
    const find=id=>draft.find(x=>x.id===id);
    function move(dragId,toId,intoFolder=false){
        if(dragId===toId)return;
        const moving=find(dragId),destination=find(toId);if(!moving||!destination)return;
        let chunk=[moving];
        if(moving.type==='folder'){
            if(intoFolder)return; // One folder level keeps layout predictable.
            chunk= draft.filter(x=>x.id===moving.id||x.folder_id===moving.id);
        }
        if(chunk.some(x=>x.id===toId))return;
        for(const r of chunk){const i=draft.indexOf(r);if(i>=0)draft.splice(i,1);}
        if(intoFolder&&destination.type==='folder'){
            moving.folder_id=destination.id;
            if(moving.type==='folder')moving.folder_id=null;
            const last=draft.map((x,i)=>x.id===toId||x.folder_id===toId?i:-1).reduce((a,b)=>Math.max(a,b),-1);
            draft.splice(last+1,0,...chunk);
        }else{
            if(moving.type!=='folder')moving.folder_id=destination.folder_id||null;
            const i=draft.indexOf(destination);draft.splice(i<0?draft.length:i,0,...chunk);
        }
        selected=moving.id;render();
    }
    function add(type){if(draft.length>=MAX){msg.textContent=`Limit of ${MAX} rows reached`;return;}
        const id=uuid();let row;
        if(type==='folder')row={id,type,name:'New Folder',color:'blue'};
        else if(type==='text')row={id,type,name:'Text',enabled:true,show_text_fields:true,expose_input:false,positive_text:'',negative_text:'',folder_id:null};
        else {const lib=mainLibraries(available).find(x=>x.entries.length);if(!lib){msg.textContent='Import a library first';return;}
            row={id,type:'library',name:lib.name,auto_label:true,enabled:true,expose_input:false,library_id:lib.id,preset_id:lib.entries[0].id,variables:{},folder_id:null};
        }
        const pos=draft.findIndex(x=>x.id===selected);
        let insertAt=pos<0?draft.length:pos+1;
        if(pos>=0){
            const target=draft[pos];
            if(type!=='folder'){
                row.folder_id=target.type==='folder'?target.id:(target.folder_id||null);
                if(row.folder_id){const end=draft.reduce((last,item,i)=>item.id===row.folder_id||item.folder_id===row.folder_id?i+1:last,insertAt);insertAt=end;}
            }
        }
        draft.splice(insertAt,0,row);selected=id;render(true);
    }
    function remove(){const b=find(selected);if(!b)return;
        const index=draft.indexOf(b);draft.splice(index,1);
        if(b.type==='folder')for(const child of draft.filter(x=>x.folder_id===b.id))child.folder_id=null;
        selected=draft[Math.min(index,draft.length-1)]?.id||'';render();
    }
    // Keep instructions and the root action accessible while only the rows
    // scroll. Rebuilding a selected row must not jump a long list back to top.
    const socketPanel=h('div','cpm-socket-panel');
    socketPanel.append(h('strong','','Node sockets'),
        check('Show CLIP input',socketDraft.clip,v=>socketDraft.clip=v),
        check('Show CONDITIONING outputs',socketDraft.conditioning,v=>socketDraft.conditioning=v));
    const socketHint=h('p','cpm-caption','For chained composers, disable CLIP and conditioning on intermediate stages. The Positive/Negative STRING ports remain available.');
    socketPanel.append(socketHint);
    const sidebarHelp=h('div','cpm-caption cpm-sidebar-help','Drag rows to reorder. Drop on a folder to group. Folders add headings, not tags.');
    const sidebarRows=h('div','cpm-sidebar-list');
    const ungroup=btn('↗ Move selected to root',()=>{const b=find(selected);if(b?.folder_id){b.folder_id=null;const i=draft.indexOf(b);draft.splice(i,1);draft.push(b);render(true);}},'cpm-sidebar-root');
    left.append(socketPanel,sidebarHelp,sidebarRows,ungroup);
    function drawSidebar(ensureSelectedVisible=false){
        const scrollTop=sidebarRows.scrollTop;
        sidebarRows.replaceChildren();
        for(const b of draft){const row=h('div',`cpm-sideitem ${b.type==='folder'?'folder':''} ${b.id===selected?'active':''}`);
            row.draggable=true;row.dataset.id=b.id;
            if(b.folder_id)row.style.paddingLeft='27px';
            const accent=inheritedAccent(b,draft);
            if(accent){row.style.borderLeft=`3px solid ${accent}`;
                if(b.type==='folder')row.style.background=rgba(accent,0.15);}
            row.append(h('span','handle','⋮⋮'),h('span','name',b.type==='folder'?`▾ ${b.name}`:b.name));
            row.addEventListener('click',()=>{selected=b.id;render();});
            row.addEventListener('dragstart',ev=>{ev.dataTransfer.setData('text/plain',b.id);ev.dataTransfer.effectAllowed='move';});
            row.addEventListener('dragover',ev=>{ev.preventDefault();row.classList.add('dragover');});
            row.addEventListener('dragleave',()=>row.classList.remove('dragover'));
            row.addEventListener('drop',ev=>{ev.preventDefault();row.classList.remove('dragover');const id=ev.dataTransfer.getData('text/plain');
                if(b.type==='folder')move(id,b.id,true);else move(id,b.id,false);
            });
            sidebarRows.append(row);
        }
        const bottomDrop=h('div','cpm-sidebar-end-drop','↓ Drop here to move below the last library');
        bottomDrop.addEventListener('dragover',ev=>{ev.preventDefault();bottomDrop.classList.add('dragover');});
        bottomDrop.addEventListener('dragleave',()=>bottomDrop.classList.remove('dragover'));
        bottomDrop.addEventListener('drop',ev=>{
            ev.preventDefault();bottomDrop.classList.remove('dragover');const dragId=ev.dataTransfer.getData('text/plain');const moving=find(dragId);if(!moving)return;
            const chunk=moving.type==='folder'?draft.filter(x=>x.id===dragId||x.folder_id===dragId):[moving];
            for(const item of chunk){const i=draft.indexOf(item);if(i>=0)draft.splice(i,1);}
            if(moving.type!=='folder')moving.folder_id=null;
            draft.push(...chunk);selected=dragId;render(true);
        });sidebarRows.append(bottomDrop);
        sidebarRows.scrollTop=scrollTop;
        if(ensureSelectedVisible)sidebarRows.querySelector?.('.cpm-sideitem.active')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }
    function drawDetails(){right.replaceChildren();const b=find(selected);if(!b){right.append(h('p','cpm-caption','Select a library or text row.'));return;}
        const title=h('strong','',b.type==='folder'?'Folder':b.type==='library'?'Library Selector':'Text Field');right.append(title);
        right.append(fld('Label',b.name,v=>{b.name=v;if(b.type==='library')b.auto_label=false;drawSidebar();}));
        if(b.type==='folder'){
            right.append(h('p','cpm-caption','Choose one of 12 accents. The folder header and all contained libraries/text rows inherit this colour in the node. The header is displayed in uppercase; your saved label is unchanged.'));
            const palette=h('div','cpm-color-palette');
            for(const color of FOLDER_COLORS){
                const swatch=btn('',()=>{b.color=color.id;drawSidebar();drawDetails();},'cpm-color-swatch'+(colorById(b.color).id===color.id?' selected':''));
                swatch.title=color.label;swatch.setAttribute('aria-label',`${color.label} folder colour`);
                swatch.dataset.color=color.id;
                const dot=h('span','cpm-color-dot');dot.style.background=color.hex;
                swatch.append(dot,h('span','',color.label));palette.append(swatch);
            }
            right.append(palette);
            right.append(h('p','cpm-caption','Drag library or text rows onto this folder in the left panel. Folders organize the node; they do not add prompt tags.'));
        }else{
            right.append(check('Enabled',b.enabled,v=>b.enabled=v));
            if(b.type==='library'){
                const libs=mainLibraries(available).length?mainLibraries(available):[{id:b.library_id,name:b.library_id,entries:[]}];
                const holder=h('div','cpm-grid');
                holder.append(select('Library',libs.map(x=>[x.id,displayLibrary(x)]),b.library_id,v=>{
                    b.library_id=v;b.variables={};const lib=libFor(available,v);b.preset_id=lib?.entries[0]?.id||'';
                    if(b.auto_label){b.name=lib?.name||v;}
                    render();
                }),select('Preset',(presetsFor(b,available).length?presetsFor(b,available):[{id:b.preset_id,name:b.preset_id}]).map(x=>[x.id,x.name]),b.preset_id,v=>{b.preset_id=v;b.variables={};render();}));right.append(holder);
                const defs=slotDefs(b,available);
                if(Object.keys(defs).length){
                    right.append(h('strong','','Optional modifiers'));
                    const modGrid=h('div','cpm-grid');
                    for(const [slot,def] of Object.entries(defs)){
                        if(def.type==='text'){
                            const field=fld(`${def.label||slot} · Free text`,b.variables?.[slot]||'',v=>{
                                b.variables={...(b.variables||{}),[slot]:v.slice(0,2000)};
                            });
                            field.lastChild.maxLength=2000;
                            field.lastChild.placeholder=def.placeholder||'Leave empty to omit';
                            modGrid.append(field);
                        }else{
                            const lib=libFor(available,def.library);
                            const choices=[['','None (leave out)'],...(lib?.entries||[]).map(x=>[x.id,x.name])];
                            modGrid.append(select(`${def.label||slot} · ${lib?.name||def.library}`,choices,b.variables?.[slot]||'',v=>{b.variables={...(b.variables||{}),[slot]:v};}));
                        }
                    }
                    right.append(modGrid);
                    right.append(h('p','cpm-caption','Optional variables: None or blank inserts nothing. Small dropdowns and text fields also appear directly on the node.'));
                }
                right.append(btn('✎ Edit this preset / library',()=>setTab('libraries',b.library_id,b.preset_id),'cpm-primary'));
                right.append(check('Auto-update label when changing libraries',b.auto_label,v=>b.auto_label=v));
                right.append(h('p','cpm-caption','Library positive and negative tags are inserted together. A connected STRING overrides only its corresponding positive or negative text.'));
            }else{
                const holder=h('div','cpm-grid');holder.append(fld('Positive text',b.positive_text,v=>b.positive_text=v,true),fld('Negative text',b.negative_text,v=>b.negative_text=v,true));right.append(holder);
                right.append(check('Show Positive and Negative text fields on node',b.show_text_fields!==false,v=>b.show_text_fields=v));
                right.append(h('p','cpm-caption','Off = a compact on/off row. Text remains saved, usable by the prompt, and editable here. This does not remove optional STRING sockets.'));
            }
            right.append(check('Expose both Positive (+) and Negative (−) STRING inputs',b.expose_input,v=>b.expose_input=v));
            const parent=h('div');parent.append(select('Folder',[['','No folder (root)'],...draft.filter(x=>x.type==='folder').map(x=>[x.id,x.name])],b.folder_id||'',v=>{
                b.folder_id=v||null;
                // Keep members next to their folder when assigned from detail view.
                if(v){const i=draft.indexOf(b);draft.splice(i,1);const index=draft.map((x,i)=>x.id===v||x.folder_id===v?i:-1).reduce((a,c)=>Math.max(a,c),-1);draft.splice(index+1,0,b);}
                render();
            }));right.append(parent);
        }
        right.append(h('div','cpm-actions'));right.lastChild.append(btn('Delete row',remove,'cpm-danger'));
    }
    const render=(ensureSelectedVisible=false)=>{drawSidebar(ensureSelectedVisible);drawDetails();};
    const importBtn=btn('↑ Import library JSON',()=>{
        const el=h('input');el.type='file';el.accept='.json,application/json';el.addEventListener('change',async()=>{
            try{const file=el.files?.[0];if(!file)return;if(file.size>500000)throw Error('File larger than 500 KB');
                await request('/uninodes/composer/library',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});
                available=await catalog();n._cpmCatalog=available;msg.textContent=`Imported ${file.name}`;render();
            }catch(e){msg.textContent=`Import failed: ${e.message}`;}
        });el.click();
    });
    footer.append(btn('+ Library',()=>add('library')),btn('+ Text',()=>add('text')),btn('+ Folder',()=>add('folder')),
        importBtn,btn('▤ Library Manager',()=>setTab('libraries')),
        msg,btn('Cancel',close),btn('Apply',()=>{
            try{
                if(draft.some(x=>x.type==='library'&&!x.preset_id))throw Error('One library row has no preset');
                if(draft.some(x=>x.folder_id&&!draft.some(y=>y.type==='folder'&&y.id===x.folder_id)))throw Error('Invalid folder assignment');
                if(!socketDraft.clip){
                    const clip=n.inputs?.find(i=>i.name==='clip');
                    if(clip?.link!=null && !window.confirm?.('The CLIP input is connected. Hiding it will disconnect that link. Continue?'))return;
                    if(clip?.link!=null){const index=n.inputs.indexOf(clip);n.disconnectInput?.(index);}
                }
                writeSocketSettings(n,socketDraft);
                save(n,draft);reconcile(n);close();
            }catch(e){msg.textContent=e.message;}
        },'cpm-primary'));
    if(!n._cpmCatalog)catalog().then(x=>{available=x;n._cpmCatalog=x;render();}).catch(e=>msg.textContent=e.message);
    render();setTab(options.tab||'blocks',options.libraryId,options.presetId);
}
app.registerExtension({name:'uninodes.composer',async beforeRegisterNodeDef(def,data){
    if(data.name!==TYPE)return;
    const previous=def.prototype.onNodeCreated;
    def.prototype.onNodeCreated=function(...args){const x=previous?.apply(this,args);reconcile(this);return x;};
    const config=def.prototype.onConfigure;
    def.prototype.onConfigure=function(...args){
        const state=args[0];
        for(const input of state?.inputs||[]){
            if(input.name==='checkpoint_positive')input.name='positive';
            if(input.name==='checkpoint_negative')input.name='negative';
        }
        const values=state?.widgets_values;
        if(Array.isArray(values)){
            // v1.5.11 had [main+, main-, blocks_json, socket_settings].
            // v1.4 had [main+, main-, old toggles, blocks_json] (or 5 values).
            // v1.5.12 saves only [blocks_json, socket_settings].
            const isBlocks=value=>typeof value==='string'&&value.trim().startsWith('[')&&(()=>{try{return Array.isArray(JSON.parse(value));}catch{return false;}})();
            // A legacy main prompt might itself be JSON-array-like text.
            // Prefer recognizing a blocks_json value in position 2+ so that
            // such prompt content is not mistaken for a new-format workflow.
            const olderLayout=values.length>=3&&values.some((v,i)=>i>=2&&isBlocks(v));
            const firstIsBlock=isBlocks(values[0])&&!olderLayout;
            if(!firstIsBlock && values.length>=2){
                const oldPositive=typeof values[0]==='string'?values[0]:'';
                const oldNegative=typeof values[1]==='string'?values[1]:'';
                const blocksIndex=values.findIndex((v,i)=>i>=2&&isBlocks(v));
                let rows=[];
                if(blocksIndex>=0){try{rows=JSON.parse(values[blocksIndex]);}catch{/* keep empty */}}
                if(!Array.isArray(rows))rows=[];
                const marker=rows.findIndex(x=>x?.type==='main');
                let at;
                if(marker>=0){
                    at=marker;rows=rows.filter(x=>x?.type!=='main');
                }else{
                    // Original prefix/suffix layouts had no explicit anchor.
                    const prefix=rows.filter(x=>x?.placement!=='suffix');
                    const suffix=rows.filter(x=>x?.placement==='suffix');
                    at=prefix.length;rows=[...prefix,...suffix];
                }
                const linkedPositive=(state.inputs||[]).some(i=>i.name==='positive_prompt'&&i.link!=null);
                const linkedNegative=(state.inputs||[]).some(i=>i.name==='negative_prompt'&&i.link!=null);
                const id='cpm_previous_prompt';
                if(oldPositive||oldNegative||linkedPositive||linkedNegative){
                    const unique=rows.some(x=>x.id===id)?`b_old_main_${Date.now().toString(36)}`:id;
                    rows.splice(Math.min(at,rows.length),0,{id:unique,type:'text',name:'Previous Main Prompt',
                        positive_text:oldPositive,negative_text:oldNegative,enabled:true,
                        show_text_fields:true,expose_input:linkedPositive||linkedNegative,folder_id:null});
                    for(const input of state.inputs||[]){
                        if(input.name==='positive_prompt')input.name=connector({id:unique},'positive');
                        if(input.name==='negative_prompt')input.name=connector({id:unique},'negative');
                    }
                }
                const settings=values.find((v,i)=>i>blocksIndex&&typeof v==='string'&&v.includes('"clip"'));
                state.widgets_values=[JSON.stringify(rows),settings||'{"clip":false,"conditioning":false}'];
            }else if(firstIsBlock){
                // Older versions might contain the obsolete anchor in blocks_json.
                let rows=JSON.parse(values[0]);
                if(rows.some(x=>x?.type==='main')){
                    rows=rows.filter(x=>x?.type!=='main');
                    state.widgets_values=[JSON.stringify(rows),values[1]||'{"clip":false,"conditioning":false}'];
                }
            }
        }
        // Reorder saved legacy output slots before LiteGraph installs them.
        // Defer the graph-link update until the graph link table is restored.
        const migrated=migrationLinks(state?.outputs);
        const x=config?.apply(this,args);
        setTimeout(()=>{
            const count=repairGraphLinks(this,migrated);
            reconcile(this);
            // In a few ComfyUI builds the global links table is restored
            // after node configuration. Retry once after graph load.
            if(count<migrated.length)setTimeout(()=>repairGraphLinks(this,migrated),150);
        },0);
        return x;
    };
}});
