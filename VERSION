/* Direct Image Sampler Finisher Ultra Turbo Deluxe
 * One resizable ComfyUI Nodes 1.0 / 2.0 DOM widget; reuse both studios.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
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
    .ud-celebrate {flex:none;display:grid;place-items:center;width:30px;height:29px;
      border:1px solid #50657c;border-radius:8px;background:#26374a;color:#d8e5f1;
      padding:0;cursor:pointer;font:17px/1 system-ui,sans-serif;opacity:.62;
      transition:background .16s,border-color .16s,opacity .16s,box-shadow .16s}
    .ud-celebrate:hover {opacity:1;background:#344960;border-color:#85a8c6}
    .ud-celebrate[aria-pressed="true"] {opacity:1;background:#594368;border-color:#d38bee;
      box-shadow:inset 0 0 0 1px #bf8dd143,0 0 9px #a35bd744}
    .ud-celebrate:focus-visible {outline:2px solid #b9d9fc;outline-offset:2px}
    .ud-celebrate.ud-party-pop {animation:ud-party-pop .62s ease-out}
    @keyframes ud-party-pop {0%,100%{transform:scale(1)}30%{transform:scale(1.28) rotate(-12deg)}
      60%{transform:scale(.91) rotate(10deg)}}
    @media (prefers-reduced-motion: reduce) {.ud-celebrate {transition:none}
      .ud-celebrate.ud-party-pop {animation:none}}
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

// A deliberately frivolous, UI-only canvas overlay. The completion event is
// emitted AFTER Deluxe's sampler + finisher return their final image pair.
// Drawing in a fixed viewport portal means particles can escape the DOM widget
// and LiteGraph node boundaries without resizing nodes or touching image data.
const PARTY_DURATION_MS = 2650;
const PARTY_COLORS = ['#ffd166','#fb82b6','#67dfc1','#92a4ff','#78caff','#e7a3ff','#ff907c'];
let partyListenerInstalled = false;

function stopParty(node) {
  node._udStopParty?.();
  node._udStopParty = null;
}

function celebrate(node) {
  if (!node.properties?.ud_confetti_enabled || !node._udRoot?.isConnected) return;
  // The native OS/browser reduced-motion preference always wins.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  const bounds = node._udRoot.getBoundingClientRect();
  if (bounds.width < 60 || bounds.height < 60 || bounds.right < 0 || bounds.left > window.innerWidth ||
      bounds.bottom < 0 || bounds.top > window.innerHeight) return;

  stopParty(node); // A new queued run gets its own celebration, not stacked frames.
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;background:transparent';
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) return;
  document.body.append(canvas);
  const button = node._udPartyButton;
  button?.classList.remove('ud-party-pop');
  // Restart CSS keyframes even if the previous celebration just ended.
  if (button) {void button.offsetWidth;button.classList.add('ud-party-pop');}

  let raf = 0, finished = false, last = 0, start = 0;
  let width = 0, height = 0, pixelRatio = 1;
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    // Cap canvas backing pixels on high-DPI/4K screens to avoid huge allocations.
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(10000000 / Math.max(1, width * height)));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }
  resize();

  const pieces = [];
  // Two cannons at the node's lower corners; a fan of pieces crosses all
  // three columns and a few drift outside the node. Tiny gold stars included.
  const count = Math.max(80, Math.min(190, Math.round(bounds.width / 9)));
  for (let i=0; i<count; i++) {
    const left = i % 2 === 0;
    pieces.push({
      x: left ? bounds.left + 15 : bounds.right - 15,
      y: bounds.bottom - 16,
      vx: (left ? 1 : -1) * (Math.random()<.14 ? -1 : 1) * (2.2 + Math.random() * 7.7),
      vy: -(7 + Math.random() * 8.6),
      gravity: .15 + Math.random() * .085,
      phase: Math.random() * Math.PI * 2,
      turn: (Math.random()-.5)*.19,
      angle: Math.random()*Math.PI*2,
      flutter: .13+Math.random()*.3,
      w: 3+Math.random()*5,
      h: 3+Math.random()*8,
      color: PARTY_COLORS[i%PARTY_COLORS.length],
      star: i%17===0,
    });
  }
  const end = () => {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    canvas.remove();
    button?.classList.remove('ud-party-pop');
    if (node._udStopParty === end) node._udStopParty = null;
  };
  node._udStopParty = end;
  function frame(now) {
    if (finished) return;
    if (!node._udRoot?.isConnected || !node.properties?.ud_confetti_enabled) {end();return;}
    if (!start) start = now;
    if (!last) last = now;
    const elapsed = now - start;
    if (elapsed >= PARTY_DURATION_MS) {end();return;}
    const delta = Math.min(2.5, Math.max(0, (now - last) / (1000/60)));
    last = now;
    if (width!==window.innerWidth || height!==window.innerHeight ||
        pixelRatio!==Math.min(window.devicePixelRatio||1,2,Math.sqrt(10000000/Math.max(1,window.innerWidth*window.innerHeight)))) resize();
    ctx.clearRect(0, 0, width, height);
    const fade = elapsed>1950 ? Math.max(0, (PARTY_DURATION_MS-elapsed)/(PARTY_DURATION_MS-1950)) : 1;
    for (const piece of pieces) {
      piece.x += (piece.vx+Math.sin(elapsed/175+piece.phase)*piece.flutter)*delta;
      piece.y += piece.vy*delta;
      piece.vy += piece.gravity*delta;
      piece.vx *= Math.pow(.996, delta);
      piece.angle += piece.turn*delta;
      if (piece.y > height+30 || piece.x < -30 || piece.x > width+30) continue;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.angle);
      ctx.globalAlpha = fade;
      ctx.fillStyle = piece.star ? '#ffdc76' : piece.color;
      if (piece.star) {
        ctx.beginPath();
        for (let k=0;k<10;k++) {
          const angle = k*Math.PI/5-Math.PI/2;
          const rad = k%2 ? piece.w*.47 : piece.w*1.12;
          const x=Math.cos(angle)*rad, y=Math.sin(angle)*rad;
          if (k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.closePath(); ctx.fill();
      } else ctx.fillRect(-piece.w/2,-piece.h/2,piece.w,piece.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}

function listenForDeluxeFinish() {
  if (partyListenerInstalled) return;
  partyListenerInstalled = true;
  api.addEventListener('executed', event => {
    const detail = event.detail || {};
    const id = detail.display_node ?? detail.node;
    if (id == null) return;
    const node = app.graph?.getNodeById?.(Number(id));
    if (node?.type !== NODE || !node.properties?.ud_confetti_enabled) return;
    // Other nodes may emit 'executed' during the same run. Only fire when
    // Deluxe itself has returned the successful FINAL finisher result.
    if (!Array.isArray(detail.output?.if_images) || !detail.output.if_images.length) return;
    const promptId = detail.prompt_id == null ? null : String(detail.prompt_id);
    if (promptId && node._udLastPartyPromptId === promptId) return;
    if (promptId) node._udLastPartyPromptId = promptId;
    celebrate(node);
  });
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
  const partyButton=document.createElement('button');
  partyButton.type='button';
  partyButton.className='ud-celebrate';
  partyButton.textContent='🎉';
  const syncPartyButton=()=>{
    const on=node.properties?.ud_confetti_enabled===true;
    partyButton.setAttribute('aria-pressed',String(on));
    partyButton.setAttribute('aria-label',on?'Turn off completion confetti':'Turn on completion confetti');
    partyButton.title=on?'Completion confetti on':'Completion confetti off';
  };
  syncPartyButton();
  partyButton.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    node.properties??={};
    node.properties.ud_confetti_enabled = node.properties.ud_confetti_enabled !== true;
    syncPartyButton();
    if (!node.properties.ud_confetti_enabled) stopParty(node);
    app.graph?.setDirtyCanvas?.(true,true);
  });
  header.append(logo,title,tag,partyButton);
  node._udRoot=root;
  node._udPartyButton=partyButton;
  listenForDeluxeFinish();
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
    queueMicrotask(()=>{separator.setRatio(this.properties?.ud_sampler_width??.32);syncPartyButton();});
    return result;
  };
  const previousRemoved=node.onRemoved;
  node.onRemoved=function(...args){
    stopParty(this);
    this._udRoot=null;
    this._udPartyButton=null;
    return previousRemoved?.apply(this,args);
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
