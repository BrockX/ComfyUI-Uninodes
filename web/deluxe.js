/* Direct Image Sampler Finisher Ultra Turbo Deluxe
 * One resizable ComfyUI Nodes 1.0 / 2.0 DOM widget; reuse both studios.
 */
import { app } from "../../scripts/app.js";
import { installSampler } from "./direct_sampler.js";
import { installFinisher } from "./image_finisher.js";

const NODE = "CPMDirectImageSamplerFinisherUltraTurboDeluxe";

function cssOnce() {
  if (document.getElementById('uninodes-deluxe-style')) return;
  const style=document.createElement('style');
  style.id='uninodes-deluxe-style';
  style.textContent=`
    .ud-root,.ud-root * {box-sizing:border-box}
    .ud-root {display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;
      padding:4px;color:#dbeafd;background:#141e2b;font:12px system-ui,Segoe UI,sans-serif;
      user-select:none;overflow:hidden;border-radius:12px}
    .ud-header {display:flex;align-items:center;gap:10px;flex:none;min-height:39px;
      border:1px solid #476b81;border-radius:9px;background:linear-gradient(100deg,#263d59,#1f3541 65%,#2b4744);
      margin-bottom:6px;padding:6px 13px}
    .ud-logo {display:grid;place-items:center;width:29px;height:29px;border-radius:8px;
      background:#527d96;color:#f1ffff;font-size:17px}
    .ud-heading {font-size:12px;font-weight:800;letter-spacing:.6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ud-tag {color:#aac4d5;font-size:10px;margin-left:auto;white-space:nowrap}
    .ud-scroll {min-width:0;min-height:0;flex:1;overflow:auto;scrollbar-width:thin;scrollbar-color:#66879c #172838}
    .ud-workspace {display:grid;grid-template-columns:minmax(275px,var(--ud-sampler,32%)) 10px minmax(640px,1fr);
      gap:6px;min-width:1100px;width:100%;height:100%;min-height:0}
    .ud-sampler,.ud-finisher {min-width:0;min-height:0;height:100%;overflow:hidden}
    .ud-separator {border-radius:7px;border:1px solid #51718b;
      background:linear-gradient(#30475d,#223546);cursor:col-resize;
      position:relative;touch-action:none;user-select:none;z-index:3}
    .ud-separator:after {content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:3px;height:48px;background:#9bcbde;border-radius:5px}
    .ud-separator:hover,.ud-separator.active {filter:brightness(1.22)}
    .ud-root .ud-sampler.ds-root,.ud-root .ud-finisher.if-root {padding:0;height:100%;width:100%}
    .ud-root .ds-frame {grid-template-columns:minmax(0,1fr)!important;padding:8px;height:100%;gap:0}
    .ud-root .ds-right,.ud-root .ds-splitter {display:none!important}
    .ud-root .ds-left {grid-column:1;grid-row:1;padding-right:2px;min-height:0}
    .ud-root .ds-combined-progress {margin-top:2px;flex:none}
    .ud-root .if-frame {grid-template-columns:minmax(230px,var(--if-left,42%)) 10px minmax(0,1fr);
      padding:8px;height:100%}
    .ud-root .if-left,.ud-root .if-right {min-height:0}
    .ud-root .ds-header,.ud-root .if-header {flex-wrap:wrap;gap:6px}
    .ud-root .ds-top-actions,.ud-root .if-top-actions {gap:4px}
    .ud-root .ds-header .ds-title,.ud-root .if-header .if-title {letter-spacing:.5px}
    .ud-root .if-compare-bar .if-dimensions {flex-basis:100%;order:1}
    @media (max-width:850px){.ud-tag{display:none}}
  `;
  document.head.append(style);
}

function attachSeparator(layout,node) {
  const handle=document.createElement('div');
  handle.className='ud-separator';
  handle.title='Drag to adjust sampler / finisher column widths';
  handle.setAttribute('role','separator');
  handle.setAttribute('aria-orientation','vertical');
  let pointer=null;
  const setRatio = (value,save=false)=>{
    const ratio=Math.min(0.52,Math.max(0.26,Number(value)||0.32));
    layout.style.setProperty('--ud-sampler',`${ratio*100}%`);
    if(save){node.properties??={};node.properties.ud_sampler_width=ratio;app.graph?.setDirtyCanvas(true,true);}
  };
  setRatio(node.properties?.ud_sampler_width ?? .32);
  for(const name of ['pointerdown','mousedown','dblclick'])
    handle.addEventListener(name,e=>e.stopPropagation());
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    pointer=e.pointerId;
    handle.classList.add('active');
    handle.setPointerCapture(pointer);
  });
  handle.addEventListener('pointermove',e=>{
    if(pointer!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();
    const rect=layout.getBoundingClientRect();
    setRatio((e.clientX-rect.left)/Math.max(1,rect.width));
  });
  const finish=e=>{
    if(pointer!==e.pointerId)return;
    pointer=null;
    handle.classList.remove('active');
    const rect=layout.getBoundingClientRect();
    setRatio((e.clientX-rect.left)/Math.max(1,rect.width),true);
    if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener('pointerup',finish);
  handle.addEventListener('pointercancel',finish);
  handle.addEventListener('lostpointercapture',e=>{
    if(pointer!==e.pointerId)return;
    pointer=null;handle.classList.remove('active');
  });
  return {handle,setRatio};
}

function install(node){
  if(node._udInstalled)return;
  node._udInstalled=true;
  if(typeof node.addDOMWidget!=='function'){
    console.warn('[Uninodes Deluxe] DOM widgets unavailable in this ComfyUI version');
    return;
  }
  cssOnce();
  node.properties??={};
  const root=document.createElement('div');root.className='ud-root';
  for(const ev of ['mousedown','pointerdown','dblclick'])root.addEventListener(ev,event=>event.stopPropagation());
  const header=document.createElement('div');header.className='ud-header';
  const logo=document.createElement('span');logo.className='ud-logo';logo.textContent='✦';
  const title=document.createElement('strong');title.className='ud-heading';
  title.textContent='DIRECT IMAGE SAMPLER FINISHER ULTRA TURBO DELUXE';
  const tag=document.createElement('span');tag.className='ud-tag';tag.textContent='Generate → Enhance → Compare → Save';
  header.append(logo,title,tag);
  const scroll=document.createElement('div');scroll.className='ud-scroll';
  const layout=document.createElement('div');layout.className='ud-workspace';
  const sampler=document.createElement('div');sampler.className='ud-sampler ds-root';
  const finisher=document.createElement('div');finisher.className='ud-finisher if-root';
  const separator=attachSeparator(layout,node);
  layout.append(sampler,separator.handle,finisher);
  scroll.append(layout);root.append(header,scroll);
  const widget=node.addDOMWidget('ultra_turbo_deluxe_studio','custom',root,{
    serialize:false,hideOnZoom:false,margin:0,
    // The DOM scrolls when the node is resized smaller than its contents.
    getHeight:()=>Math.max(280,(node.size?.[1]||830)-75),
    getMinHeight:()=>280,getMaxHeight:()=>5000,
  });
  widget.serialize=false;
  // Each original editor manages its own handlers, settings and previews.
  // Shared root keeps a SINGLE node-resizable DOM widget.
  installSampler(node,{root:sampler,combined:true});
  installFinisher(node,{root:finisher,combined:true});
  const priorConfigure=node.onConfigure;
  node.onConfigure=function(...args){
    const result=priorConfigure?.apply(this,args);
    queueMicrotask(()=>separator.setRatio(this.properties?.ud_sampler_width??.32));
    return result;
  };
  node.setSize?.([Math.max(1420,node.size?.[0]||0),Math.max(800,node.size?.[1]||0)]);
}

app.registerExtension({
  name:'uninodes.deluxe',
  async beforeRegisterNodeDef(type,data){
    if(data.name!==NODE)return;
    const previous=type.prototype.onNodeCreated;
    type.prototype.onNodeCreated=function(...args){
      const result=previous?.apply(this,args);
      install(this);
      return result;
    };
  },
});
