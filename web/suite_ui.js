/* Shared CPM DOM controls. Native Comfy widgets remain the serialized source of truth.
 * Placeholder icon glyphs can later be replaced by Illustrator SVG assets.
 * Compatible with legacy canvas nodes and Nodes 2.0 via addDOMWidget.
 */
import { app } from '../../scripts/app.js';

export const widget = (n, key) => n.widgets?.find(w => w.name === key);
export const val = (n, key) => widget(n, key)?.value;
export const graphDirty = () => app.graph?.setDirtyCanvas(true, true);
export const e = (tag, className='', text='') => {
    const node = document.createElement(tag);
    if(className)node.className=className;
    if(text !== undefined && text !== null)node.textContent=String(text);
    return node;
};
const icons = {checkpoint:'◈',library:'▦',finisher:'✦'};
let styled = false;
export function styleSuite(){
    if(styled || typeof document === 'undefined')return;
    if(document.getElementById('cpm-suite-styles')){styled=true;return;}
    styled=true;
    const style=e('style');style.id='cpm-suite-styles';style.textContent=`
.cpm-suite-panel,.cpm-suite-panel *,.cpm-suite-dialog,.cpm-suite-dialog *{box-sizing:border-box}
.cpm-suite-panel{width:100%;padding:4px 8px 6px;display:flex;flex-direction:column;gap:8px;color:#eef2fc;font:12px system-ui,sans-serif;user-select:none;overflow:visible}
.cpm-suite-card{background:#282f3b;border:1px solid #425067;border-radius:9px;padding:9px 11px;position:relative;min-width:0}
.cpm-suite-card::before{content:'';position:absolute;top:9px;bottom:9px;left:1px;width:3px;border-radius:3px;background:var(--cpm-suite-accent,#82ace8)}
.cpm-suite-heading{display:flex;gap:9px;align-items:center;margin-bottom:2px}
.cpm-suite-icon{flex:0 0 30px;width:30px;height:30px;border-radius:9px;border:1px solid color-mix(in srgb,var(--cpm-suite-accent,#8aaae7) 46%,#4a566c);background:color-mix(in srgb,var(--cpm-suite-accent,#8aaae7) 18%,#273344);display:grid;place-items:center;color:var(--cpm-suite-accent,#98b8e9);font-size:19px;font-weight:700}
.cpm-suite-icon[data-icon]{background-position:center;background-repeat:no-repeat;background-size:22px}
.cpm-suite-title{font-size:12px;font-weight:800;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpm-suite-subtitle{font-size:10px;color:#9facbf;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpm-suite-section-label{font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#a8b5c8;margin:1px 0 5px}
.cpm-suite-field{display:flex;flex-direction:column;gap:5px;min-width:0;color:#c1cce0;font-size:11px}
.cpm-suite-field>span:first-child{font-weight:650}
.cpm-suite-panel select,.cpm-suite-panel input,.cpm-suite-panel textarea,.cpm-suite-dialog select,.cpm-suite-dialog input,.cpm-suite-dialog textarea{background:#171e2b!important;color:#f2f6ff!important;border:1px solid #4c5d75!important;border-radius:7px!important;padding:7px 9px!important;font:12px system-ui,sans-serif!important;min-width:0;width:100%;outline:none;user-select:text}
.cpm-suite-panel select:focus,.cpm-suite-panel input:focus,.cpm-suite-panel textarea:focus,.cpm-suite-dialog select:focus,.cpm-suite-dialog input:focus,.cpm-suite-dialog textarea:focus{border-color:#81a7e3!important}
.cpm-suite-panel select option,.cpm-suite-dialog select option{background:#192536;color:#f1f5ff}
.cpm-suite-panel textarea,.cpm-suite-dialog textarea{resize:vertical;min-height:43px}
.cpm-suite-panel button,.cpm-suite-dialog button{font:12px system-ui,sans-serif;cursor:pointer;border:1px solid #51617b;background:#33445b;color:#ecf3ff;border-radius:7px;padding:7px 10px;outline-offset:3px}
.cpm-suite-panel button:hover,.cpm-suite-dialog button:hover{filter:brightness(1.18)}
.cpm-suite-panel button:disabled,.cpm-suite-dialog button:disabled{opacity:.45;cursor:not-allowed}
.cpm-suite-panel button.cpm-suite-primary,.cpm-suite-dialog button.cpm-suite-primary{background:#355e98;border-color:#597cbd;font-weight:700}
.cpm-suite-panel button.cpm-suite-settings{width:100%;height:34px;border-radius:8px;background:#2a3444;border-color:#52627b;font-weight:750}
.cpm-suite-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-width:0}
.cpm-suite-meta{font-size:11px;color:#b0bed2;line-height:1.4;overflow-wrap:anywhere}
.cpm-suite-status{padding:7px 9px;background:#1c2837;border:1px solid #394a60;border-radius:7px;color:#a9c1df;font-size:10px;line-height:1.4;max-height:52px;overflow:auto;overflow-wrap:anywhere}
.cpm-suite-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.cpm-suite-modes button{padding:7px 4px;font-size:11px}
.cpm-suite-modes button.active,.cpm-suite-tab.active{background:#2e507e!important;border-color:#6d98d3!important;color:#fff!important}
.cpm-suite-switches{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.cpm-suite-switch{display:flex;align-items:center;gap:6px;min-height:32px;width:100%;border-radius:8px!important;padding:6px 8px!important;text-align:left!important;font-size:11px!important;background:#303842!important;border-color:#485266!important;color:#aab7c8!important}
.cpm-suite-switch.on{background:color-mix(in srgb,var(--cpm-suite-accent,#80b6a0) 22%,#303b49)!important;border-color:var(--cpm-suite-accent,#7daeae)!important;color:#f0fff8!important}
.cpm-suite-switch .dot{height:7px;width:7px;border-radius:50%;background:#768293;flex:0 0 7px}
.cpm-suite-switch.on .dot{background:var(--cpm-suite-accent,#88d4b0);box-shadow:0 0 5px var(--cpm-suite-accent,#88d4b0)}
.cpm-suite-overlay{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;padding:16px;background:#070b12c9;color:#edf3fe;font:13px system-ui,sans-serif}
.cpm-suite-dialog{height:min(730px,93vh);width:min(970px,96vw);max-height:93vh;display:flex;flex-direction:column;background:#1b2230;border:1px solid #4b5870;border-radius:12px;box-shadow:0 22px 80px #000b;overflow:hidden}
.cpm-suite-dialog>header,.cpm-suite-dialog>footer{flex:0 0 auto;padding:13px 17px;background:#202a3b;display:flex;gap:8px;align-items:center}
.cpm-suite-dialog>header{border-bottom:1px solid #354153;justify-content:space-between;font-size:16px;font-weight:800}
.cpm-suite-dialog>footer{border-top:1px solid #354153;justify-content:flex-end;flex-wrap:wrap}
.cpm-suite-dialog>.body{flex:1;display:grid;grid-template-columns:minmax(185px,26%) minmax(0,1fr);min-height:0}
.cpm-suite-dialog nav{background:#171f2d;border-right:1px solid #394659;padding:13px 10px;display:flex;flex-direction:column;gap:5px;overflow-y:auto}
.cpm-suite-dialog section{display:flex;flex-direction:column;gap:13px;min-height:0;overflow-y:auto;padding:18px}
.cpm-suite-dialog .cpm-suite-tab{display:block;width:100%;text-align:left;background:transparent;border:1px solid transparent;padding:11px;border-radius:8px;color:#b9c9df;font-weight:600}
.cpm-suite-dialog .cpm-suite-tab:hover{background:#2a384a}
.cpm-suite-dialog .cpm-suite-hint{color:#9eafc7;font-size:12px;line-height:1.5}
.cpm-suite-dialog .cpm-suite-box{background:#202c3b;border:1px solid #3d4f68;border-radius:9px;padding:13px;display:flex;flex-direction:column;gap:11px}
.cpm-suite-dialog .cpm-suite-box>strong{font-size:13px}
.cpm-suite-dialog .cpm-suite-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cpm-suite-dialog .cpm-suite-field input,.cpm-suite-dialog .cpm-suite-field select,.cpm-suite-dialog .cpm-suite-field textarea{font-size:13px!important;padding:9px!important}
.cpm-suite-dialog .cpm-suite-actions{display:flex;flex-wrap:wrap;gap:8px}
@media(max-width:650px){.cpm-suite-dialog>.body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.cpm-suite-dialog nav{flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid #394659}.cpm-suite-dialog nav button{width:auto!important}.cpm-suite-dialog section{padding:12px}.cpm-suite-dialog .cpm-suite-two{grid-template-columns:1fr}}
`;
    document.head.appendChild(style);
}
export function badgeIcon(id){const item=e('span','cpm-suite-icon',icons[id]||'◇');item.dataset.icon=id;return item;}
export function heading(id,title,subtitle=''){
    const row=e('div','cpm-suite-heading');row.append(badgeIcon(id));
    const t=e('div');t.style.minWidth='0';t.append(e('div','cpm-suite-title',title),e('div','cpm-suite-subtitle',subtitle));
    row.append(t);return row;
}
export function box(...children){const c=e('div','cpm-suite-card');c.append(...children.filter(Boolean));return c;}
export function label(text,control){const x=e('label','cpm-suite-field');x.append(e('span','',text),control);return x;}
export function caption(text){return e('div','cpm-suite-meta',text);}
export function button(text,click,cls=''){const b=e('button',cls,text);b.type='button';b.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();click(ev);});return b;}
export function choices(w){return Array.isArray(w?.options?.values)?w.options.values:[];}
export function select(current,options,change){
    const s=e('select');
    const values=Array.isArray(options)?options:[];
    for(const value of values){const p=e('option','',String(value));p.value=String(value);s.append(p);}
    if(current!==undefined && current!==null && !values.map(String).includes(String(current))){const p=e('option','',String(current));p.value=String(current);s.prepend(p);}
    s.value=String(current??'');
    s.addEventListener('change',()=>change(s.value));return s;
}
export function textInput(current,change,{type='text',multiline=false,step=1,min,max,rows=3,commit='change'}={}){
    const input=e(multiline?'textarea':'input');
    if(!multiline){input.type=type;if(type==='number'){input.step=String(step);if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);}}
    else input.rows=rows;
    input.value=String(current??'');
    input.addEventListener(commit,()=>change(type==='number'?Number(input.value):input.value));
    return input;
}
export function changeWidget(n,key,next,{notify=true}={}){
    const w=widget(n,key);if(!w)return false;
    if(Object.is(w.value,next))return true;
    w.value=next;
    if(notify)try{w.callback?.(next,undefined,n);}catch(err){console.error('[CPM] Widget callback',key,err);}
    graphDirty();
    queueMicrotask(()=>n._cpmSuiteRender?.());
    return true;
}
export function conceal(n,keys){
    for(const key of keys){const w=widget(n,key);if(!w||w._cpmSuiteHidden)continue;
        w._cpmSuiteHidden=true;w._cpmSuiteWasType=w.type;
        w.type='hidden';w.hidden=true;
        w.computeSize=()=>[0,-4];w.options??={};w.options.hidden=true;
        // Only original values serialize; runtime action buttons never serialize.
        if(w._cpmSuiteWasType!=='button'&&w.serialize!==false)w.options.serialize=true;
        for(const p of ['element','inputEl'])if(w[p]?.style)w[p].style.display='none';
    }
}
export function mountPanel(n,{id,height,accent,render,hidden=[]}){
    if(n._cpmSuitePanel)return n._cpmSuitePanel;
    if(typeof n.addDOMWidget!=='function'){
        console.warn('[CPM] DOM widgets unavailable; retaining native widgets');return null;
    }
    styleSuite();
    const root=e('div','cpm-suite-panel');root.style.setProperty('--cpm-suite-accent',accent||'#7aa8d9');
    for(const event of ['pointerdown','mousedown','dblclick'])root.addEventListener(event,ev=>ev.stopPropagation());
    let widgetDom;
    try{
        widgetDom=n.addDOMWidget('cpm_suite_'+id,'custom',root,{
            serialize:false,hideOnZoom:false,margin:0,
            getHeight:()=>height,getMinHeight:()=>height,getMaxHeight:()=>height,
        });
    }catch(err){console.warn('[CPM] Could not mount suite DOM controls',err);return null;}
    widgetDom.serialize=false;widgetDom._cpmRuntime=true;
    n._cpmSuitePanel=root;n._cpmSuiteDOMWidget=widgetDom;
    conceal(n,hidden);
    root.style.minHeight=`${height}px`;
    root.style.setProperty('--comfy-widget-height',`${height}px`);
    const width=Math.max(Number(n.size?.[0]||0),id==='finisher'?342:360);
    const computed=n.computeSize?.();
    const finalHeight=Math.max(height+50,Array.isArray(computed)?Number(computed[1]||0):0);
    if(typeof n.setSize==='function')n.setSize([width,finalHeight]);
    else if(Array.isArray(n.size)){n.size[0]=width;n.size[1]=finalHeight;}
    const update=()=>{try{root.replaceChildren(...render());}catch(err){console.error('[CPM] Suite panel render',err);}};
    n._cpmSuiteRender=update;
    update();return root;
}
export function dialog(title,tabs,renderTab,onApply){
    styleSuite();
    const overlay=e('div','cpm-suite-overlay');const modal=e('div','cpm-suite-dialog');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    const header=e('header');header.append(e('span','',title));
    const close=()=>overlay.remove();
    header.append(button('✕',close));modal.append(header);
    const body=e('div','body');const nav=e('nav');const detail=e('section');body.append(nav,detail);modal.append(body);
    const footer=e('footer');const error=e('span','cpm-suite-hint','');error.style.marginRight='auto';footer.append(error);
    footer.append(button('Cancel',close),button('Apply',()=>{
        try{flush?.();onApply?.();close();}
        catch(err){error.textContent=err.message;}
    },'cpm-suite-primary'));
    modal.append(footer);overlay.append(modal);document.body.append(overlay);
    let flush=null;
    function choose(id){
        flush?.();flush=null;
        nav.replaceChildren(...tabs.map(([key,name])=>button(name,()=>choose(key),'cpm-suite-tab'+(key===id?' active':''))));
        detail.replaceChildren();
        flush=renderTab(id,detail)||null;
    }
    choose(tabs[0][0]);
    return {overlay,close,choose,footer,error};
}
