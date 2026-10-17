import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { changeWidget, badgeIcon } from "./suite_ui.js";

const NODE_NAME = "CPMImageFinisher";
const DELUXE_NODE = "CPMDirectImageSamplerFinisherUltraTurboDeluxe";
const isFinisherType = type => type === NODE_NAME || type === DELUXE_NODE;
const get = (node, name) => node.widgets?.find(w => w.name ===
  (node._ifCombined && name === "settings_json" ? "finisher_settings_json" : name));
const dirty = () => app.graph?.setDirtyCanvas(true, true);

function hideWidget(widget) {
  if (!widget) return;
  widget.type = "hidden";
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.options ??= {};
  widget.options.hidden = true;
  widget.options.serialize = true;
  for (const key of ["element", "inputEl"]) if (widget[key]?.style) widget[key].style.display = "none";
}

async function request(url, options = {}) {
  const res = await api.fetchApi(url, options);
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error(`HTTP ${res.status}: ${body.slice(0, 140).trim() || 'Empty server response'}. Check that Uninodes loaded successfully and restart ComfyUI.`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function parseSettings(node) {
  try {
    return JSON.parse(get(node, "settings_json")?.value || "{}");
  } catch {
    return {};
  }
}

function deepMerge(base, incoming) {
  if (!base || typeof base !== "object") return structuredClone(incoming);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

function writeSettings(node, settings) {
  const w = get(node, "settings_json");
  if (!w) return;
  w.value = JSON.stringify(settings);
  updateStatus(node);
  dirty();
}

function scheduleFinisherRender(node){if(node._ifRenderQueued)return;node._ifRenderQueued=true;queueMicrotask(()=>{node._ifRenderQueued=false;node._cpmSuiteRender?.();});}

function updateStatus(node) {
  if (!node._ifStatus) return;
  const cfg = parseSettings(node);
  const pieces = [];
  const mu = cfg.model_upscale || {};
  const dr = cfg.diffusion_refine || {};
  if (get(node, "upscale_using_model")?.value) pieces.push(`model ×${cfg.simple_upscale?.scale ?? 2}: ${mu.model_name || "choose model"}`);
  else if (get(node, "simple_upscale")?.value) pieces.push(`simple ×${cfg.simple_upscale?.scale ?? 2}`);
  if (get(node, "diffusion_refine")?.value) pieces.push(`refine: ${dr.denoise ?? 0.25}`);
  for (const key of ["face_detailer", "eye_detailer", "hand_detailer"]) {
    const label = key.split("_")[0];
    const det = cfg[key] || {};
    if (det.detector) pieces.push(`${label}: ${det.detector}`);
  }
  if ((cfg.watermark || {}).text) pieces.push("watermark");
  node._ifStatus.value = pieces.length ? pieces.join(" • ") : "Click Settings to configure";
  scheduleFinisherRender(node);
  dirty();
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node.style, props.style || {});
  if (props.className) node.className = props.className;
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.innerHTML !== undefined) node.innerHTML = props.innerHTML;
  for (const [k, v] of Object.entries(props)) {
    if (["style", "className", "textContent", "innerHTML"].includes(k)) continue;
    node[k] = v;
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) node.appendChild(child);
  }
  return node;
}

function styledSelect(options, value) {
  const s = el("select", { style: sharedInputStyle() });
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(value)) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

function styledInput(type, value, step = null) {
  const i = el("input", { type, style: sharedInputStyle() });
  if (value !== undefined && value !== null && type !== "checkbox") i.value = value;
  if (step !== null) i.step = step;
  if (type === "checkbox") {
    i.checked = Boolean(value);
    i.style.width = "auto";
    i.style.padding = "0";
    i.style.accentColor = "#4aa3ff";
  }
  return i;
}

function sharedInputStyle() {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,.12)",
    background: "#24354a",
    color: "#f5f5f5",
    boxSizing: "border-box",
  };
}

function field(label, control, note = "") {
  const wrap = el("label", { style: { display: "grid", gridTemplateColumns: "180px 1fr", gap: "12px", alignItems: "center", marginBottom: "12px" } });
  const left = el("div", {});
  left.appendChild(el("div", { textContent: label, style: { fontWeight: "700", fontSize: "12px" } }));
  if (note) left.appendChild(el("div", { textContent: note, style: { fontSize: "11px", opacity: "0.7", marginTop: "2px" } }));
  wrap.append(left, control);
  return wrap;
}

function checkboxField(label, control, note = "") {
  const wrap = field(label, control, note);
  wrap.style.gridTemplateColumns = "220px auto";
  return wrap;
}

function card(title, subtitle = "") {
  const box = el("div", { style: { border: "1px solid rgba(255,255,255,.08)", borderRadius: "12px", background: "rgba(255,255,255,.03)", padding: "14px 16px", marginBottom: "16px" } });
  box.appendChild(el("div", { textContent: title, style: { fontWeight: "800", marginBottom: subtitle ? "4px" : "12px", fontSize: "13px" } }));
  if (subtitle) box.appendChild(el("div", { textContent: subtitle, style: { fontSize: "12px", opacity: "0.76", marginBottom: "12px", lineHeight: "1.4" } }));
  return box;
}

function modalShell(title) {
  const overlay = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,.62)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
  const panel = el("div", { style: { width: "min(1080px, 94vw)", height: "min(780px, 90vh)", background: "#1b2230", color: "#ecf1fc", border: "1px solid #4b5870", borderRadius: "12px", boxShadow: "0 24px 80px rgba(0,0,0,.45)", display: "flex", flexDirection: "column", overflow: "hidden" } });
  panel.className = "cpm-suite-dialog cpm-finisher-dialog";
  overlay.appendChild(panel);
  const header = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 17px", background: "#202a3b", borderBottom: "1px solid #354153" } });
  const headingWrap = el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } });
  headingWrap.append(badgeIcon("finisher"), el("div", { textContent: title, style: { fontWeight: "800", fontSize: "16px" } }));
  header.append(headingWrap);
  const closeBtn = el("button", { textContent: "✕", type: "button", style: { padding: "6px 10px", cursor: "pointer", borderRadius: "8px", border: "1px solid rgba(255,255,255,.10)", background: "#24354a", color: "#fff" } });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = el("div", { style: { display: "grid", gridTemplateColumns: "240px 1fr", flex: "1 1 auto", minHeight: "0" } });
  const left = el("div", { style: { borderRight: "1px solid #394659", display: "flex", flexDirection: "column", minHeight: "0", background: "#171f2d" } });
  const right = el("div", { style: { minHeight: "0", overflow: "auto", padding: "18px" } });
  body.append(left, right);
  panel.appendChild(body);

  const footer = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", padding: "14px 18px", borderTop: "1px solid #354153", background: "#202a3b" } });
  panel.appendChild(footer);

  function cleanup() { overlay.remove(); }
  closeBtn.onclick = cleanup;
  overlay.addEventListener("click", e => { if (e.target === overlay) cleanup(); });
  document.body.appendChild(overlay);
  return { overlay, left, right, footer, close: cleanup };
}

function buildPresetOptions(map) {
  return Object.entries(map || {}).map(([value, item]) => ({ value, label: item.label || value }));
}

function applyPreset(detailerCfg, presetMap, presetKey) {
  detailerCfg.preset = presetKey;
  const patch = (presetMap?.[presetKey]?.values) || {};
  for (const [k, v] of Object.entries(patch)) detailerCfg[k] = v;
}

function detailerEditor(stageKey, label, config, options, advanced) {
  const presetMap = options.detailer_presets?.[stageKey] || {};
  const section = card(`${label} detailer`, `These settings apply when the ${label.toLowerCase()} toggle on the node is enabled.`);
  const preset = styledSelect(buildPresetOptions(presetMap), config.preset || "default");
  const detector = styledSelect([{ value: "", label: "— Select detector —" }, ...(options.detector_models || []).map(v => ({ value: v, label: v }))], config.detector || "");
  const sam = styledSelect([{ value: "", label: "— None —" }, ...(options.sam_models || []).map(v => ({ value: v, label: v }))], config.sam_model || "");
  const guide = styledInput("number", config.guide_size, "1");
  const denoise = styledInput("number", config.denoise, "0.01");
  section.append(
    field("Preset", preset, "Quick starting points; you can still tweak values afterwards."),
    field("Detector", detector),
    field("SAM model", sam),
    field("Guide size", guide),
    field("Denoise", denoise),
  );

  let refs = { preset, detector, sam, guide, denoise };
  if (advanced) {
    const maxSize = styledInput("number", config.max_size, "1");
    const steps = styledInput("number", config.steps, "1");
    const cfg = styledInput("number", config.cfg, "0.1");
    const sampler = styledSelect((options.samplers || ["euler"]).map(v => ({ value: v, label: v })), config.sampler_name);
    const scheduler = styledSelect((options.schedulers || ["normal"]).map(v => ({ value: v, label: v })), config.scheduler);
    const bboxThreshold = styledInput("number", config.bbox_threshold, "0.01");
    const bboxDilation = styledInput("number", config.bbox_dilation, "1");
    const bboxCrop = styledInput("number", config.bbox_crop_factor, "0.1");
    const feather = styledInput("number", config.feather, "1");
    const dropSize = styledInput("number", config.drop_size, "1");
    const cycle = styledInput("number", config.cycle, "1");
    const samHint = styledSelect([
      { value: "center-1", label: "center-1" },
      { value: "horizontal-2", label: "horizontal-2" },
      { value: "vertical-2", label: "vertical-2" },
      { value: "rect-4", label: "rect-4" },
      { value: "diamond-4", label: "diamond-4" },
      { value: "mask-area", label: "mask-area" },
    ], config.sam_detection_hint);
    const samDilation = styledInput("number", config.sam_dilation, "1");
    const samThreshold = styledInput("number", config.sam_threshold, "0.01");
    const samBBoxExpansion = styledInput("number", config.sam_bbox_expansion, "1");
    const samMaskHintThreshold = styledInput("number", config.sam_mask_hint_threshold, "0.01");
    const guideFor = styledInput("checkbox", config.guide_size_for);
    const useNegative = styledSelect([{ value: "False", label: "False" }, { value: "True", label: "True" }], config.sam_mask_hint_use_negative);
    section.append(
      field("Max size", maxSize),
      field("Steps", steps),
      field("CFG", cfg),
      field("Sampler", sampler),
      field("Scheduler", scheduler),
      field("BBox threshold", bboxThreshold),
      field("BBox dilation", bboxDilation),
      field("BBox crop factor", bboxCrop),
      field("Feather", feather),
      field("Drop size", dropSize),
      field("Cycles", cycle),
      field("SAM hint", samHint),
      field("SAM dilation", samDilation),
      field("SAM threshold", samThreshold),
      field("SAM bbox expansion", samBBoxExpansion),
      field("SAM mask hint threshold", samMaskHintThreshold),
      field("Mask hint negative", useNegative),
      checkboxField("Guide size for crop", guideFor)
    );
    section.appendChild(el("div", { textContent: label === "Face" ? "Tip: for glasses, larger bbox dilation and crop factor usually help preserve the full face context." : "Use advanced controls when the default crop is too tight or too loose.", style: { fontSize: "11px", opacity: "0.72", marginTop: "2px" } }));
    refs = { ...refs, maxSize, steps, cfg, sampler, scheduler, bboxThreshold, bboxDilation, bboxCrop, feather, dropSize, cycle, samHint, samDilation, samThreshold, samBBoxExpansion, samMaskHintThreshold, guideFor, useNegative };
  }

  function syncInputsFromConfig() {
    refs.preset.value = config.preset || "default";
    refs.detector.value = config.detector || "";
    refs.sam.value = config.sam_model || "";
    refs.guide.value = config.guide_size ?? 512;
    refs.denoise.value = config.denoise ?? 0.4;
    if (advanced) {
      refs.maxSize.value = config.max_size ?? 1024;
      refs.steps.value = config.steps ?? 18;
      refs.cfg.value = config.cfg ?? 2.0;
      refs.sampler.value = config.sampler_name || "euler";
      refs.scheduler.value = config.scheduler || "normal";
      refs.bboxThreshold.value = config.bbox_threshold ?? 0.5;
      refs.bboxDilation.value = config.bbox_dilation ?? 15;
      refs.bboxCrop.value = config.bbox_crop_factor ?? 3.0;
      refs.feather.value = config.feather ?? 5;
      refs.dropSize.value = config.drop_size ?? 10;
      refs.cycle.value = config.cycle ?? 1;
      refs.samHint.value = config.sam_detection_hint || "center-1";
      refs.samDilation.value = config.sam_dilation ?? 0;
      refs.samThreshold.value = config.sam_threshold ?? 0.93;
      refs.samBBoxExpansion.value = config.sam_bbox_expansion ?? 0;
      refs.samMaskHintThreshold.value = config.sam_mask_hint_threshold ?? 0.7;
      refs.guideFor.checked = Boolean(config.guide_size_for);
      refs.useNegative.value = config.sam_mask_hint_use_negative || "False";
    }
  }

  preset.addEventListener("change", () => {
    applyPreset(config, presetMap, preset.value);
    syncInputsFromConfig();
  });

  section._save = () => Object.assign(config, {
    preset: refs.preset.value,
    detector: refs.detector.value,
    sam_model: refs.sam.value,
    guide_size: Number(refs.guide.value || 512),
    denoise: Number(refs.denoise.value || 0.4),
    ...(advanced ? {
      max_size: Number(refs.maxSize.value || 1024),
      steps: Number(refs.steps.value || 18),
      cfg: Number(refs.cfg.value || 2),
      sampler_name: refs.sampler.value,
      scheduler: refs.scheduler.value,
      bbox_threshold: Number(refs.bboxThreshold.value || 0.5),
      bbox_dilation: Number(refs.bboxDilation.value || 15),
      bbox_crop_factor: Number(refs.bboxCrop.value || 3.0),
      feather: Number(refs.feather.value || 5),
      drop_size: Number(refs.dropSize.value || 10),
      cycle: Number(refs.cycle.value || 1),
      sam_detection_hint: refs.samHint.value,
      sam_dilation: Number(refs.samDilation.value || 0),
      sam_threshold: Number(refs.samThreshold.value || 0.93),
      sam_bbox_expansion: Number(refs.samBBoxExpansion.value || 0),
      sam_mask_hint_threshold: Number(refs.samMaskHintThreshold.value || 0.7),
      guide_size_for: refs.guideFor.checked,
      sam_mask_hint_use_negative: refs.useNegative.value,
    } : {})
  });

  return section;
}


async function openSettings(node) {
  const options = node._ifOptions || await request("/uninodes/finisher/options");
  node._ifOptions = options;
  let config = deepMerge(options.defaults || {}, parseSettings(node));

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "simple_upscale", label: "Simple Upscale" },
    { id: "model_upscale", label: "Model Upscale" },
    { id: "diffusion_refine", label: "Diffusion Refine" },
    { id: "face", label: "Face" },
    { id: "eyes", label: "Eyes" },
    { id: "hands", label: "Hands" },
    { id: "watermark", label: "Watermark" },
    { id: "mirror", label: "Mirror" },
    { id: "export", label: "Export naming" },
  ];

  const state = {
    mode: config.ui_mode || "simple",
    section: config.active_section || "overview",
  };

  const modal = modalShell("Image Finisher Settings");

  const modeBar = el("div", { style: { padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,.08)" } });
  const modeGroup = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } });
  function modeButton(id, label) {
    const btn = el("button", { type: "button", textContent: label, style: { padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,.10)", background: state.mode === id ? "rgba(74,163,255,.28)" : "rgba(255,255,255,.04)", color: "#fff", fontWeight: "700", cursor: "pointer" } });
    btn.onclick = () => { saver?.(); state.mode = id; renderNav(); renderSection(); };
    return btn;
  }
  modeGroup.append(modeButton("simple", "Simple"), modeButton("advanced", "Advanced"));
  modeBar.appendChild(modeGroup);
  modal.left.appendChild(modeBar);

  const navScroll = el("div", { style: { overflow: "auto", padding: "12px", minHeight: "0", flex: "1 1 auto" } });
  modal.left.appendChild(navScroll);

  function renderNav() {
    modeGroup.innerHTML = "";
    modeGroup.append(modeButton("simple", "Simple"), modeButton("advanced", "Advanced"));
    navScroll.innerHTML = "";
    for (const sec of sections) {
      const active = state.section === sec.id;
      const row = el("button", { type: "button", textContent: sec.label, style: { width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: "6px", borderRadius: "10px", border: "1px solid rgba(255,255,255,.08)", background: active ? "rgba(74,163,255,.22)" : "rgba(255,255,255,.03)", color: active ? "#fff" : "rgba(255,255,255,.9)", cursor: "pointer", fontWeight: active ? "700" : "600" } });
      row.onclick = () => { saver?.(); state.section = sec.id; renderNav(); renderSection(); };
      navScroll.appendChild(row);
    }
  }

  let saver = null;
  function renderSection() {
    modal.right.innerHTML = "";
    const advanced = state.mode === "advanced";
    config.ui_mode = state.mode;
    config.active_section = state.section;
    let sectionNode = null;
    if (state.section === "overview") {
      const box = card("Pipeline order", "Image Finisher runs stages in this order: mirror → upscale → diffusion refine → face → eyes → hands → watermark.");
      const ul = el("div", { style: { display: "grid", gap: "10px" } });
      const toggles = [
        ["simple_upscale", "Simple Upscale"], ["upscale_using_model", "Model Upscale"], ["diffusion_refine", "Diffusion Refine"], ["face", "Face"], ["eyes", "Eyes"], ["hands", "Hands"], ["mirror", "Mirror"], ["watermark", "Watermark"]
      ];
      for (const [name, label] of toggles) {
        const enabled = Boolean(get(node, name)?.value);
        ul.appendChild(el("div", { textContent: `${enabled ? "●" : "○"} ${label} ${enabled ? "enabled on node" : "disabled on node"}`, style: { fontSize: "12px", opacity: enabled ? "0.96" : "0.72" } }));
      }
      box.appendChild(ul);
      const box2 = card("Notes", "Use Simple mode for quick setup. Switch to Advanced when you need precise control, like glasses-friendly face detailing.");
      box2.append(
        el("div", { textContent: "• Both upscale modes share one target scale. A 1.5× target remains 1.5× even with a 4× ESRGAN model.", style: { fontSize: "12px", marginBottom: "6px", opacity: "0.86" } }),
        el("div", { textContent: "• Diffusion Refine uses tiled Ultimate SD Upscale in no-upscale mode.", style: { fontSize: "12px", marginBottom: "6px", opacity: "0.86" } }),
        el("div", { textContent: "• Face / Eyes / Hands have separate settings and detector presets.", style: { fontSize: "12px", opacity: "0.86" } }),
      );
      modal.right.append(box, box2);
      saver = () => {};
      return;
    }

    if (state.section === "simple_upscale") {
      sectionNode = card("Simple upscale", "Choose the final size relative to the source image. Model upscale uses this same target scale.");
      const scale = styledInput("number", config.simple_upscale.scale, "0.1");
      const method = styledSelect([
        { value: "lanczos", label: "Lanczos" }, { value: "bicubic", label: "Bicubic" }, { value: "bilinear", label: "Bilinear" }, { value: "area", label: "Area" }, { value: "nearest", label: "Nearest" }
      ], config.simple_upscale.method);
      scale.min = "1"; scale.max = "8";
      sectionNode.append(field("Target scale", scale, "Also applies to Model Upscale"), field("Resize method", method));
      saver = () => { config.simple_upscale.scale = Number(scale.value || 2); config.simple_upscale.method = method.value; };
    } else if (state.section === "model_upscale") {
      sectionNode = card("Model upscale", "ESRGAN runs at its native size internally, then the image is resized to your chosen target. Enlargement factors do not multiply.");
      const model = styledSelect([{ value: "", label: "— Select upscale model —" }, ...(options.upscale_models || []).map(v => ({ value: v, label: v }))], config.model_upscale.model_name);
      const scale = styledInput("number", config.simple_upscale.scale, "0.1");
      scale.min = "1"; scale.max = "8";
      sectionNode.append(field("Upscale model", model), field("Target scale", scale, "Relative to source, even for ESRGAN 4×"));
      saver = () => { config.model_upscale.model_name = model.value; config.simple_upscale.scale = Number(scale.value || 2); };
    } else if (state.section === "diffusion_refine") {
      sectionNode = card("Diffusion refine", "Tiled refinement using Ultimate SD Upscale in no-upscale mode.");
      const dr = config.diffusion_refine;
      const steps = styledInput("number", dr.steps, "1");
      const cfg = styledInput("number", dr.cfg, "0.1");
      const denoise = styledInput("number", dr.denoise, "0.01");
      const sampler = styledSelect((options.samplers || ["euler"]).map(v => ({ value: v, label: v })), dr.sampler_name);
      const scheduler = styledSelect((options.schedulers || ["normal"]).map(v => ({ value: v, label: v })), dr.scheduler);
      const tileW = styledInput("number", dr.tile_width, "8");
      const tileH = styledInput("number", dr.tile_height, "8");
      sectionNode.append(field("Denoise", denoise), field("Steps", steps), field("CFG", cfg), field("Sampler", sampler), field("Scheduler", scheduler), field("Tile width", tileW), field("Tile height", tileH));
      let refs = { steps, cfg, denoise, sampler, scheduler, tileW, tileH };
      if (advanced) {
        const tilePadding = styledInput("number", dr.tile_padding, "8");
        const maskBlur = styledInput("number", dr.mask_blur, "1");
        const modeType = styledSelect([{ value: "Linear", label: "Linear" }, { value: "Chess", label: "Chess" }, { value: "None", label: "None" }], dr.mode_type);
        const seamMode = styledSelect([{ value: "None", label: "None" }, { value: "Band Pass", label: "Band Pass" }, { value: "Half Tile", label: "Half Tile" }, { value: "Half Tile + Intersections", label: "Half Tile + Intersections" }], dr.seam_fix_mode);
        const seamDenoise = styledInput("number", dr.seam_fix_denoise, "0.01");
        const seamWidth = styledInput("number", dr.seam_fix_width, "8");
        const seamBlur = styledInput("number", dr.seam_fix_mask_blur, "1");
        const seamPadding = styledInput("number", dr.seam_fix_padding, "8");
        const uniform = styledInput("checkbox", dr.force_uniform_tiles);
        const tiledDecode = styledInput("checkbox", dr.tiled_decode);
        const batchSize = styledInput("number", dr.batch_size, "1");
        sectionNode.append(field("Tile redraw", modeType), field("Tile padding", tilePadding), field("Mask blur", maskBlur), field("Seam fix", seamMode), field("Seam denoise", seamDenoise), field("Seam width", seamWidth), field("Seam mask blur", seamBlur), field("Seam padding", seamPadding), checkboxField("Force uniform tiles", uniform), checkboxField("Tiled decode", tiledDecode), field("Batch size", batchSize));
        refs = { ...refs, tilePadding, maskBlur, modeType, seamMode, seamDenoise, seamWidth, seamBlur, seamPadding, uniform, tiledDecode, batchSize };
      }
      saver = () => Object.assign(dr, {
        steps: Number(refs.steps.value || 20), cfg: Number(refs.cfg.value || 1), denoise: Number(refs.denoise.value || 0.25), sampler_name: refs.sampler.value, scheduler: refs.scheduler.value, tile_width: Number(refs.tileW.value || 768), tile_height: Number(refs.tileH.value || 768),
        ...(advanced ? { tile_padding: Number(refs.tilePadding.value || 32), mask_blur: Number(refs.maskBlur.value || 8), mode_type: refs.modeType.value, seam_fix_mode: refs.seamMode.value, seam_fix_denoise: Number(refs.seamDenoise.value || 0.2), seam_fix_width: Number(refs.seamWidth.value || 64), seam_fix_mask_blur: Number(refs.seamBlur.value || 8), seam_fix_padding: Number(refs.seamPadding.value || 16), force_uniform_tiles: refs.uniform.checked, tiled_decode: refs.tiledDecode.checked, batch_size: Number(refs.batchSize.value || 1) } : {})
      });
    } else if (state.section === "face") {
      sectionNode = detailerEditor("face", "Face", config.face_detailer, options, advanced);
      saver = sectionNode._save;
    } else if (state.section === "eyes") {
      sectionNode = detailerEditor("eyes", "Eyes", config.eye_detailer, options, advanced);
      saver = sectionNode._save;
    } else if (state.section === "hands") {
      sectionNode = detailerEditor("hands", "Hands", config.hand_detailer, options, advanced);
      saver = sectionNode._save;
    } else if (state.section === "watermark") {
      sectionNode = card("Watermark", "Position the watermark using the Studio preview gizmo; you can also edit properties directly on the node.");
      const wm = config.watermark;
      const mode = styledSelect([{value:'text',label:'Text'},{value:'image',label:'Image'}],wm.mode||'text');
      const opacity = styledInput('number',wm.opacity, '0.05');opacity.min='0';opacity.max='1';
      const rotation=styledInput('number',wm.rotation||0,'1');rotation.min='-360';rotation.max='360';
      sectionNode.append(field('Watermark type',mode),field('Opacity',opacity),field('Rotation (degrees)',rotation));
      saver=()=>Object.assign(wm,{mode:mode.value,opacity:Number(opacity.value),rotation:Number(rotation.value)});
    } else if (state.section === "export") {
      sectionNode=card('Detailed file naming','Applied to Save Detailed and Save All; Save Original keeps the base name.');
      config.export??={placement:'suffix',detail_label:'_Detailed'};
      const where=styledSelect([{value:'suffix',label:'Suffix (after filename)'},{value:'prefix',label:'Prefix (before filename)'}],config.export.placement||'suffix');
      const label=styledInput('text',config.export.detail_label??'_Detailed');
      sectionNode.append(field('Placement',where),field('Detailed label',label,'Default: _Detailed'));
      saver=()=>{config.export.placement=where.value;config.export.detail_label=label.value||'_Detailed';};
    } else if (state.section === "mirror") {
      sectionNode = card("Mirror", "Optional flip stage performed before any upscaling or refinement.");
      const mode = styledSelect([{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }, { value: "both", label: "Both" }], config.mirror.mode);
      sectionNode.append(field("Mode", mode));
      saver = () => { config.mirror.mode = mode.value; };
    }

    if (sectionNode) modal.right.appendChild(sectionNode);
  }

  const cancel = el("button", { textContent: "Cancel", type: "button", style: { padding: "9px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,.10)", background: "#24354a", color: "#fff", cursor: "pointer" } });
  const apply = el("button", { textContent: "Apply", type: "button", style: { padding: "9px 14px", borderRadius: "10px", border: "1px solid rgba(74,163,255,.22)", background: "rgba(74,163,255,.22)", color: "#fff", fontWeight: "800", cursor: "pointer" } });
  cancel.onclick = () => modal.close();
  apply.onclick = () => {
    saver?.();
    writeSettings(node, config);
    modal.close();
  };
  modal.footer.append(cancel, apply);

  renderNav();
  renderSection();
}

// Image Finisher Studio — compact controls on the left, comparison + manual save on the right.
const IF_NODES = new Map();
const STAGES = [
  ['ENLARGE', [['simple_upscale','Simple upscale'], ['upscale_using_model','Model upscale'], ['diffusion_refine','Diffusion refine']]],
  ['DETAIL', [['face','Face'], ['eyes','Eyes'], ['hands','Hands']]],
  ['UTILITY', [['mirror','Mirror'], ['watermark','Watermark']]],
];
const html=(tag,cls='',text='')=>{const a=document.createElement(tag);if(cls)a.className=cls;if(text!==undefined&&text!==null)a.textContent=String(text);return a;};
const action=(label,fn,cls='')=>{const b=html('button',cls,label);b.type='button';b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();fn(ev);};return b;};
const imageUrl=src=>api.apiURL(`/view?${new URLSearchParams({filename:src.filename,subfolder:src.subfolder||'',type:src.type||'temp'})}`);
function ifStyles(){if(document.querySelector('#cpm-finisher-studio-css'))return;const tag=html('style');tag.id='cpm-finisher-studio-css';tag.textContent=`
.if-root,.if-root *{box-sizing:border-box}.if-root{height:100%;width:100%;color:#edf5ff;font:12px system-ui,Segoe UI,sans-serif;user-select:none;padding:4px}
.if-frame{display:grid;grid-template-columns:minmax(260px,var(--if-left,39%)) 10px minmax(0,1fr);height:100%;gap:9px;padding:9px;background:#1d2833;border:1px solid #486d65;border-radius:12px;overflow:hidden}.if-splitter{pointer-events:auto!important;touch-action:none!important;user-select:none;z-index:5;grid-column:2;grid-row:1;cursor:col-resize;align-self:stretch;border-radius:8px;background:linear-gradient(180deg,#2b3646,#202938);border:1px solid #465b60;position:relative}.if-splitter::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:3px;height:42px;border-radius:999px;background:#8bcfb8;box-shadow:0 0 0 1px #0004}.if-splitter:hover,.if-splitter.dragging{filter:brightness(1.15)}
.if-left,.if-right{min-width:0;overflow:hidden;display:flex;flex-direction:column;gap:9px}.if-left{grid-column:1;grid-row:1}.if-right{grid-column:3;grid-row:1}.if-left{overflow-y:auto;padding-right:4px;scrollbar-width:thin}.if-right{background:#141f2b;border:1px solid #48615f;border-radius:10px;padding:9px}
.if-header{display:flex;align-items:center;gap:8px;min-height:36px}.if-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;border:1px solid #83c8b6;background:#285449;font-size:18px;color:#a3ead8}.if-title{font-size:13px;font-weight:800}.if-muted{font-size:10px;line-height:1.4;color:#a8bec8}
.if-root button{font:11px system-ui,sans-serif;border:1px solid #59756d;background:#334d49;color:#e7fff4;border-radius:7px;padding:7px 9px;cursor:pointer}.if-root button:hover{filter:brightness(1.14)}.if-root button:disabled{opacity:.42;cursor:not-allowed}.if-root button.active,.if-root button.if-primary{background:#356d60;border-color:#a2dacb;color:#fff;font-weight:800}
.if-switch{margin-left:auto;font-weight:900!important}.if-switch.off{background:#404755!important;color:#bac3d2!important;border-color:#677181!important}.if-card{background:#2b3b44;border:1px solid #46635f;border-radius:9px;padding:10px 11px;display:flex;flex-direction:column;gap:7px}.if-card-title{font-size:10px;color:#b6d9cb;letter-spacing:.75px;font-weight:800}.if-controls{display:grid;grid-template-columns:1fr 1fr;gap:6px}.if-controls button{text-align:left;display:flex;align-items:center;gap:7px;background:#303f47;color:#acbfbe;border-color:#50636a}.if-controls button.active{background:#355b54;color:#eafff5}.if-dot{border-radius:50%;width:7px;height:7px;flex:none;background:#738987}.if-controls button.active .if-dot{background:#a0ead2;box-shadow:0 0 6px #80d5bc}.if-root input,.if-root select{width:100%;min-width:0;border-radius:7px;background:#182d34;border:1px solid #53726f;padding:7px;color:#fff;font:12px system-ui,sans-serif;user-select:text}.if-root .if-input-label{display:flex;flex-direction:column;gap:4px;color:#aac6c5;font-size:11px}.if-root input:focus,.if-root select:focus{outline:1px solid #92d9c7}.if-dimensions{font-size:10px;color:#b6d7cc;white-space:nowrap;margin-right:auto}.if-autosave{display:flex;align-items:center;gap:4px;color:#b6d7cc;font-size:10px;white-space:nowrap}.if-autosave input{width:auto;min-width:0;accent-color:#8bdbbe}.if-compare-bar{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.if-compare-bar button{padding:6px 9px}.if-compare-bar strong{margin-right:auto;font-size:11px}.if-preview{position:relative;min-height:210px;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid #465b60;border-radius:9px;background:repeating-conic-gradient(#223039 0 25%,#1a2530 0 50%) 50%/16px 16px}.if-canvas{position:absolute;inset:0;display:flex;overflow:hidden}.if-canvas img{display:block;height:100%;width:100%;object-fit:contain;pointer-events:none}.if-canvas .if-half{position:relative;flex:1;min-width:0;overflow:hidden}.if-canvas .if-half:first-child{border-right:1px solid #88baa9}.if-canvas .if-half img{width:100%;height:100%}.if-layer{position:absolute;inset:0}.if-layer.after{clip-path:inset(0 50% 0 0)}.if-swipe-line{position:absolute;top:0;bottom:0;width:2px;left:50%;background:#ecfff3;pointer-events:none;box-shadow:0 0 5px #000}.if-swipe-knob{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;border:1px solid white;background:#2d7168;width:28px;height:28px;display:grid;place-items:center;color:#fff;font-size:14px;pointer-events:none}.if-swipe-range{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;z-index:5}.if-preview-hint{max-width:270px;color:#a5c4c1;text-align:center;line-height:1.5;padding:14px}.if-preview-scale{font-size:10px;color:#abcac6}.if-gallery{display:flex;gap:6px;overflow-x:auto;min-height:52px;padding:3px}.if-gallery button{padding:0;width:46px;height:46px;flex:0 0 46px;border-radius:6px;overflow:hidden}.if-gallery img{width:100%;height:100%;object-fit:cover}.if-status{font-size:10px;line-height:1.4;color:#b3c9d0;overflow-wrap:anywhere}.if-top-actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}.if-save{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.if-save .if-folder{display:flex;align-items:center;gap:5px;min-width:120px;flex:1 1 150px}.if-folder select{max-width:190px}.if-folder button{padding:6px 7px}.if-save-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.if-save-actions button{padding:7px 8px}.if-root.if-off .if-frame{border-color:#637078}.if-root.if-off .if-logo{background:#3f4750;border-color:#697581;color:#bac6ce}.if-root.if-off .if-controls{opacity:.55}
.if-header .if-switch{margin-left:auto}.if-header .if-sockets-toggle{font-size:10px;padding:7px 8px}.if-subcontrol{margin-top:4px;padding:6px 7px;border:1px solid #57716c;border-radius:7px;display:flex;flex-direction:column;gap:6px;background:#20333c}.if-mini-row{display:flex;align-items:center;gap:6px}.if-mini-row>*{min-width:0}.if-mini-row>span{font-size:10px;color:#b8ded4;white-space:nowrap}.if-mini-row input[type=color]{width:46px;flex:0 0 46px;height:31px;padding:3px}.if-mini-row input[type=checkbox]{width:auto}.if-mini-row .if-input-label{flex:1}.if-file-thumb{width:48px;height:48px;object-fit:contain;border:1px solid #7ca59c;border-radius:5px}.if-native-folder{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px!important}.if-gizmo-box{position:absolute;border:1px dashed #fff;background:rgba(77,217,184,.08);z-index:10;transform-origin:center center;cursor:move;touch-action:none;box-shadow:0 0 0 1px #222}.if-gizmo-content{width:100%;height:100%;display:grid;place-items:center;color:white;white-space:nowrap;overflow:hidden}.if-gizmo-handle{position:absolute;width:13px;height:13px;background:#b1ffdf;border:1px solid #255248;border-radius:3px;z-index:12;touch-action:none}.if-gizmo-resize{right:-7px;bottom:-7px;cursor:nwse-resize}.if-gizmo-rotate{left:50%;top:-25px;transform:translateX(-50%);border-radius:50%;cursor:grab}.if-gizmo-guide{position:absolute;height:15px;width:1px;left:50%;top:-15px;background:#adffda;pointer-events:none}.if-save .if-format{min-width:70px;max-width:88px}.if-save .if-folder{flex:1 1 130px}.if-save .if-folder select{max-width:135px}
`;document.head.append(tag);}
function sourcePair(n){const i=Math.min(n._ifSelected||0,Math.max(0,(n._ifImages?.length||1)-1));return n._ifImages?.[i]||null;}
function samplerPreviewActive(n){return Boolean(n?._ifCombined && n?._ifSamplerPreviewActive);}
function saveChoice(n,variant){const selected=sourcePair(n);if(!selected){n._ifSaveMessage='Generate an image before saving';n._cpmSuiteRender?.();return;}
 const folder=n.properties?.if_output_folder||'';const format=n.properties?.if_export_format||'PNG';const naming=parseSettings(n).export||{};
 n._ifSaveMessage='Saving…';n._cpmSuiteRender?.();
 request('/uninodes/finisher/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:selected.token,variant,folder,format,placement:naming.placement||'suffix',detail_label:naming.detail_label??'_Detailed'})})
 .then(result=>{n._ifSaveMessage=`Saved ${result.images.length} ${format} image${result.images.length>1?'s':''} → ${result.destination||folder||'output'}`;n._cpmSuiteRender?.();})
 .catch(err=>{n._ifSaveMessage=`Save failed: ${err.message}`;n._cpmSuiteRender?.();});}

async function autoSaveFinisher(n,pairs){
 if(!n.properties?.if_autosave)return;
 const folder=n.properties.if_output_folder||'',format=n.properties.if_export_format||'PNG',naming=parseSettings(n).export||{};
 let saved=0;
 for(const pair of pairs){
   if(!pair?.token)continue;
   await request('/uninodes/finisher/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:pair.token,variant:'detailed',folder,format,placement:naming.placement||'suffix',detail_label:naming.detail_label??'_Detailed'})});
   saved++;
 }
 n._ifSaveMessage=`Autosaved ${saved} detailed image${saved===1?'':'s'} (${format})`;
 n._cpmSuiteRender?.();
}
async function browseFolder(n){try{n._ifSaveMessage='Choose a folder in the Windows dialog…';n._cpmSuiteRender?.();const result=await request('/uninodes/finisher/browse-folder',{method:'POST'});if(result.cancelled){n._ifSaveMessage='Folder selection cancelled';n._cpmSuiteRender?.();return;}n.properties??={};n.properties.if_output_folder=result.folder;n.properties.if_native_folder_label=result.display;n._ifSaveMessage=`Destination: ${result.display}`;dirty();n._cpmSuiteRender?.();}catch(err){n._ifSaveMessage=`Native picker unavailable: ${err.message}`;n._cpmSuiteRender?.();}}
async function uploadWatermarkImage(n,file){const form=new FormData();form.append('file',file);const result=await request('/uninodes/finisher/watermark/upload',{method:'POST',body:form});const cfg=parseSettings(n);cfg.watermark??={};cfg.watermark.image=result;cfg.watermark.mode='image';writeSettings(n,cfg);n._ifSaveMessage='Watermark image uploaded — Queue Prompt to apply it';n._cpmSuiteRender?.();}
function updateFinisherConfig(n,fn){const cfg=parseSettings(n);fn(cfg);writeSettings(n,cfg);}
function removeNativePreview(n){if(!n)return;try{if(app.nodePreviewImages)delete app.nodePreviewImages[String(n.id)];n.imgs=null;}catch{}}
function attachSplitter(frame,node,key='if_left_ratio'){
  const splitter=html('div','if-splitter');
  splitter.title='Drag to resize panels';
  const variable='--if-left';
  const clamp=(raw)=>Math.max(0.26,Math.min(0.62,Number(raw)||0.39));
  let ratio=clamp(node.properties?.[key]??0.40);
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
    dirty();
  };
  splitter.addEventListener('pointerup',finish);
  splitter.addEventListener('pointercancel',finish);
  splitter.addEventListener('lostpointercapture',ev=>{
    if(pointerId!==ev.pointerId)return;
    pointerId=null;bounds=null;splitter.classList.remove('dragging');
    node.properties??={};node.properties[key]=ratio;
    dirty();
  });
  return splitter;
}
const EXTRA_SOCKETS={model:'MODEL',clip:'CLIP',vae:'VAE',positive:'CONDITIONING',negative:'CONDITIONING'};
function syncExtraSockets(n){if(n._ifCombined)return;n.properties??={};const show=Boolean(n.properties.if_extra_sockets);for(const [name,type]of Object.entries(EXTRA_SOCKETS)){const index=n.inputs?.findIndex(p=>p.name===name)??-1;if(!show&&index>=0&&!n.inputs[index].link&&typeof n.removeInput==='function')n.removeInput(index);if(show&&index<0&&typeof n.addInput==='function')n.addInput(name,type);}dirty();}
async function loadFolders(n){try{const data=await request('/uninodes/finisher/folders');n._ifFolders=data.folders||[''];n._cpmSuiteRender?.();}catch(err){n._ifSaveMessage=err.message;n._cpmSuiteRender?.();}}
async function createFolder(n){const name=window.prompt('New folder inside ComfyUI/output (you can use Parent/Child):','Finished');if(name===null)return;const target=name.trim();if(!target)return;try{const data=await request('/uninodes/finisher/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:target})});n.properties??={};n.properties.if_output_folder=target;n._ifFolders=data.folders||[''];dirty();n._cpmSuiteRender?.();}catch(err){n._ifSaveMessage=err.message;n._cpmSuiteRender?.();}}
function showWatermarkGizmo(n,holder,pair){const cfg=parseSettings(n).watermark||{};const im=html('img');im.addEventListener('error',()=>{im.style.display='none';});im.src=imageUrl(pair.original);const canvas=html('div','if-canvas');canvas.append(im);holder.append(canvas);
 const box=html('div','if-gizmo-box'),content=html('div','if-gizmo-content');box.append(content);
 const resize=html('div','if-gizmo-handle if-gizmo-resize'),rotate=html('div','if-gizmo-handle if-gizmo-rotate'),guide=html('div','if-gizmo-guide');box.append(resize,guide,rotate);holder.append(box);
 let geometry=null,operation=null;
 function recalc(){const W=holder.clientWidth,H=holder.clientHeight,iw=im.naturalWidth||pair.original.width||1024,ih=im.naturalHeight||pair.original.height||1024;const fac=Math.min(W/iw,H/ih);const dx=(W-iw*fac)/2,dy=(H-ih*fac)/2;geometry={dx,dy,width:iw*fac,height:ih*fac,fac,iw,ih};const x=Number(cfg.x??.86),y=Number(cfg.y??.90),rot=Number(cfg.rotation||0),scale=Number(cfg.scale||.22);const text=String(cfg.text||'Watermark');let bw,bh;
 if(cfg.mode==='image'){const pic=cfg.image||{};const ratio=(pic.height||100)/(pic.width||100);bw=Math.max(20,geometry.width*scale);bh=bw*ratio;const picImg=html('img');picImg.src=imageUrl(pic);picImg.style.cssText='width:100%;height:100%;object-fit:contain;pointer-events:none';content.replaceChildren(picImg);}else{const fontsize=Math.max(8,(Number(cfg.text_size)||36)*fac);content.replaceChildren(html('span','',text));content.style.fontSize=`${fontsize}px`;content.style.color=cfg.color||'#fff';bw=Math.max(45,Math.min(geometry.width*1.8,text.length*fontsize*.62));bh=Math.max(28,fontsize*1.6);}
 box.style.left=`${geometry.dx+geometry.width*x-bw/2}px`;box.style.top=`${geometry.dy+geometry.height*y-bh/2}px`;box.style.width=`${bw}px`;box.style.height=`${bh}px`;box.style.transform=`rotate(${rot}deg)`;box.style.opacity=String(cfg.opacity??.55);return {bw,bh};}
 im.onload=()=>recalc();if(im.complete)queueMicrotask(recalc);
 function pointerStart(e,which){e.preventDefault();e.stopPropagation();const rect=holder.getBoundingClientRect();operation={which,startX:e.clientX,startY:e.clientY,x:Number(cfg.x??.86),y:Number(cfg.y??.9),scale:Number(cfg.scale??.22),rotation:Number(cfg.rotation||0),textSize:Number(cfg.text_size||36),centerX:rect.left+geometry.dx+geometry.width*Number(cfg.x??.86),centerY:rect.top+geometry.dy+geometry.height*Number(cfg.y??.9)};box.setPointerCapture(e.pointerId);}
 box.addEventListener('pointerdown',e=>pointerStart(e,e.target===resize?'scale':e.target===rotate?'rotate':'move'));
 box.addEventListener('pointermove',e=>{if(!operation||!geometry)return;const o=operation;
 if(o.which==='move'){cfg.x=Math.max(0,Math.min(1,o.x+(e.clientX-o.startX)/geometry.width));cfg.y=Math.max(0,Math.min(1,o.y+(e.clientY-o.startY)/geometry.height));}
 if(o.which==='scale'){const before=Math.hypot(o.startX-o.centerX,o.startY-o.centerY);const after=Math.hypot(e.clientX-o.centerX,e.clientY-o.centerY);cfg.scale=Math.max(.01,Math.min(2,o.scale*after/Math.max(1,before)));if(cfg.mode==='text')cfg.text_size=Math.max(8,Math.min(400,Math.round(o.textSize*after/Math.max(1,before))));}
 if(o.which==='rotate'){const a=Math.atan2(o.startY-o.centerY,o.startX-o.centerX),b=Math.atan2(e.clientY-o.centerY,e.clientX-o.centerX);cfg.rotation=Math.round(o.rotation+(b-a)*180/Math.PI);}
 recalc();});
 function finish(){if(!operation)return;operation=null;updateFinisherConfig(n,c=>{c.watermark=cfg;});n._ifSaveMessage='Watermark position updated — Queue Prompt to apply';n._cpmSuiteRender?.();}
 box.addEventListener('pointerup',finish);box.addEventListener('pointercancel',finish);
}
function displayCompare(n,holder){holder.replaceChildren();
 if(samplerPreviewActive(n)){
  const wrap=html('div','if-canvas');
  if(n._ifSamplerPreviewURL){
   const img=html('img');
   img.addEventListener('error',()=>{img.style.display='none';});
   img.src=n._ifSamplerPreviewURL;
   img.draggable=false;
   wrap.append(img);
  }else{
   wrap.append(html('div','if-preview-hint','Sampling preview will appear here once denoising begins.'));
  }
  holder.append(wrap);
  return;
 }
 const pair=sourcePair(n);if(!pair){holder.append(html('div','if-preview-hint','Connect an IMAGE, enable finishing stages and Queue Prompt. The original and finished images will appear here.'));return;}
 const mode=n.properties?.if_compare_mode||'detailed';const original=imageUrl(pair.original),detailed=imageUrl(pair.detailed);const canvas=html('div','if-canvas');const createImg=(url)=>{const im=html('img');im.addEventListener('error',()=>{im.style.display='none';});im.src=url;im.draggable=false;return im;};
 if(mode==='original'){canvas.append(createImg(original));holder.append(canvas);return;}
 if(mode==='detailed'){canvas.append(createImg(detailed));holder.append(canvas);return;}
 if(mode==='side'){const left=html('div','if-half');left.append(createImg(original));const right=html('div','if-half');right.append(createImg(detailed));canvas.append(left,right);holder.append(canvas);return;}
 const left=createImg(original);left.className='if-layer';const right=createImg(detailed);right.className='if-layer after';const line=html('div','if-swipe-line');const knob=html('div','if-swipe-knob','↔');const range=html('input','if-swipe-range');range.type='range';range.min='0';range.max='100';range.value=String(n._ifSwipe??50);const apply=value=>{const v=Math.max(0,Math.min(100,Number(value)||50));n._ifSwipe=v;right.style.clipPath=`inset(0 ${100-v}% 0 0)`;line.style.left=`${v}%`;knob.style.left=`${v}%`;};range.addEventListener('input',()=>apply(range.value));apply(n._ifSwipe??50);canvas.append(left,right,line,knob,range);holder.append(canvas);} 

function renderWatermarkControls(n,card){const wm=parseSettings(n).watermark||{};const group=html('div','if-subcontrol');
 const row=html('div','if-mini-row');const type=html('select');for(const label of ['text','image']){const opt=html('option','',label==='text'?'Text':'Image');opt.value=label;type.append(opt);}type.value=wm.mode||'text';type.addEventListener('change',()=>updateFinisherConfig(n,c=>{c.watermark??={};c.watermark.mode=type.value;}));row.append(html('span','','Type'),type);group.append(row);
 function number(label,key,step,min,max){const line=html('label','if-mini-row'),txt=html('span','',label),inp=html('input');inp.type='number';inp.step=step;inp.min=min;inp.max=max;inp.value=String(wm[key]??{text_size:36,opacity:.55,rotation:0,scale:.22}[key]??0);inp.addEventListener('change',()=>updateFinisherConfig(n,c=>{c.watermark??={};c.watermark[key]=Math.max(min,Math.min(max,Number(inp.value)||0));}));line.append(txt,inp);group.append(line);}
 if((wm.mode||'text')==='text'){
 const text=html('input');text.placeholder='Watermark text';text.value=wm.text||'';text.addEventListener('change',()=>updateFinisherConfig(n,c=>{c.watermark??={};c.watermark.text=text.value;}));group.append(text);
 const line=html('div','if-mini-row'),color=html('input');color.type='color';color.value=wm.color||'#ffffff';color.addEventListener('change',()=>updateFinisherConfig(n,c=>{c.watermark??={};c.watermark.color=color.value;}));line.append(html('span','','Color'),color);group.append(line);number('Text size','text_size',1,6,400);
 }else{
 const source=wm.image;if(source){const img=html('img','if-file-thumb');img.addEventListener('error',()=>{img.style.display='none';});img.src=imageUrl(source);group.append(img);group.append(html('div','if-muted',source.name||source.filename));}
 const input=html('input');input.type='file';input.accept='image/*';input.style.display='none';input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;try{await uploadWatermarkImage(n,file);}catch(err){n._ifSaveMessage=`Watermark upload: ${err.message}`;n._cpmSuiteRender?.();}});group.append(input,action(source?'Replace image':'Load image',()=>input.click()));number('Scale','scale',.01,.01,2);
 }
 number('Opacity','opacity',.05,0,1);number('Rotation','rotation',1,-360,360);const spot=html('div','if-mini-row');for(const [label,x,y]of [['↖',.15,.15],['↑',.5,.15],['↗',.85,.15],['←',.15,.5],['⌾',.5,.5],['→',.85,.5],['↙',.15,.85],['↓',.5,.85],['↘',.85,.85]]){const b=action(label,()=>updateFinisherConfig(n,c=>{c.watermark??={};c.watermark.x=x;c.watermark.y=y;}));b.title='Place watermark';b.style.padding='4px 5px';spot.append(b);}spot.style.flexWrap='wrap';group.append(html('span','if-muted','Position'),spot);
 group.append(action(n.properties?.if_edit_watermark?'✓ Finish placement':'⬚ Adjust on preview',()=>{n.properties??={};n.properties.if_edit_watermark=!n.properties.if_edit_watermark;dirty();n._cpmSuiteRender?.();},'if-primary'));
 card.append(group);
}
function renderStudio(n){if(!n._ifRoot)return;const root=n._ifRoot;const enabled=get(n,'enabled')?.value!==false;root.classList.toggle('if-off',!enabled);root.replaceChildren();const frame=html('div','if-frame'),left=html('section','if-left'),right=html('section','if-right');frame.append(left,attachSplitter(frame,n),right);root.append(frame);
 const header=html('div','if-header');header.append(html('span','if-logo','✦'));const title=html('div');title.append(html('div','if-title','IMAGE FINISHER'),html('div','if-muted','Upscale · Diffusion · Detail'));header.append(title);const topActions=html('div','if-top-actions');const bypass=action(enabled?'● ON':'○ OFF',()=>{changeWidget(n,'enabled',!enabled);n._cpmSuiteRender?.();},'if-switch '+(enabled?'active':'off'));bypass.title=enabled?'Disable all processing; pass original through':'Enable image processing';topActions.append(bypass);if(!n._ifCombined){const extras=action(n.properties?.if_extra_sockets?'Sockets ON':'Sockets OFF',()=>{n.properties??={};n.properties.if_extra_sockets=!n.properties.if_extra_sockets;syncExtraSockets(n);n._cpmSuiteRender?.();},'if-sockets-toggle'+(n.properties?.if_extra_sockets?' active':''));extras.title='Show or hide optional MODEL/CLIP/VAE/CONDITIONING inputs';topActions.append(extras);}const settingsAction=action('⚙',async()=>{try{await openSettings(n);}catch(err){n._ifSaveMessage=err.message;n._cpmSuiteRender?.();}},'if-primary');settingsAction.title='Settings';topActions.append(settingsAction);header.append(topActions);left.append(header);
 for(const [section,steps] of STAGES){const card=html('div','if-card');card.append(html('div','if-card-title',section));const grid=html('div','if-controls');for(const [key,label] of steps){const on=Boolean(get(n,key)?.value);const button=action('',()=>{changeWidget(n,key,!on);n._cpmSuiteRender?.();},on?'active':'');button.append(html('span','if-dot'),html('span','',label));button.disabled=!enabled;grid.append(button);}card.append(grid);
 if(section==='ENLARGE'&&(get(n,'simple_upscale')?.value||get(n,'upscale_using_model')?.value)){
 const group=html('div','if-subcontrol');const row=html('label','if-mini-row');row.append(html('span','','Scaling ×'));const scale=html('input');scale.type='number';scale.min='1';scale.max='8';scale.step='0.1';scale.value=String(parseSettings(n).simple_upscale?.scale??2);scale.addEventListener('change',()=>updateFinisherConfig(n,c=>{c.simple_upscale??={};c.simple_upscale.scale=Math.max(1,Math.min(8,Number(scale.value)||2));}));row.append(scale);group.append(row);card.append(group);}
 if(section==='DETAIL'){
 const group=html('div','if-subcontrol');for(const [key,label]of [['face_detailer','Face'],['eye_detailer','Eye'],['hand_detailer','Hand']]){
 const cfg=parseSettings(n)[key]||{};const active=Boolean(cfg.prompt_enabled);const row=html('label','if-mini-row');const check=html('input');check.type='checkbox';check.checked=active;check.addEventListener('change',()=>updateFinisherConfig(n,c=>{c[key]??={};c[key].prompt_enabled=check.checked;}));row.append(check,html('span','',`${label} prompt`));group.append(row);
 if(active){const prompt=html('input');prompt.type='text';prompt.placeholder=`Positive prompt for ${label.toLowerCase()} detailer`;prompt.value=cfg.prompt||'';prompt.addEventListener('change',()=>updateFinisherConfig(n,c=>{c[key]??={};c[key].prompt=prompt.value;}));group.append(prompt);}}
 card.append(group);}
 if(section==='UTILITY'){
 {const group=html('div','if-subcontrol');const label=html('label','if-input-label','Mirror direction');const mirror=parseSettings(n).mirror?.mode||'horizontal';const pick=html('select');for(const [value,title] of [['horizontal','Horizontal'],['vertical','Vertical'],['both','Both']]){const option=html('option','',title);option.value=value;pick.append(option);}pick.value=mirror;pick.addEventListener('change',()=>{changeWidget(n,'mirror',true);updateFinisherConfig(n,c=>{c.mirror??={};c.mirror.mode=pick.value;});});label.append(pick);group.append(label);card.append(group);}
 if(get(n,'watermark')?.value)renderWatermarkControls(n,card);
 }
 left.append(card);}
 const options=html('div','if-card');options.append(html('div','if-card-title','CONFIGURATION'));if(!n._ifCombined){const seedlabel=html('label','if-input-label','Seed');const seed=html('input');seed.type='number';seed.min='0';seed.step='1';seed.value=String(get(n,'seed')?.value??0);seed.addEventListener('change',()=>changeWidget(n,'seed',Math.max(0,Number(seed.value)||0)));seedlabel.append(seed);options.append(seedlabel);}const status=html('div','if-status',n._ifSummary||(!enabled?'Bypassed — original image passed through':'Configure processing stages, then Queue Prompt'));options.append(status);left.append(options);
 const compareBar=html('div','if-compare-bar');
 const sampling=samplerPreviewActive(n);
 compareBar.append(html('strong','',n.properties?.if_edit_watermark?'WATERMARK PLACEMENT':(sampling?'SAMPLING PREVIEW':'COMPARE')));
 if(sampling){
   compareBar.append(html('span','if-dimensions',n._ifSamplerProgressLabel||'Denoising…'));
 }else{
   const pairForSize=sourcePair(n);if(pairForSize){const a=pairForSize.original,b=pairForSize.detailed;const describe=i=>i?.width&&i?.height?`${i.width}×${i.height}`:'—';compareBar.append(html('span','if-dimensions',`Original: ${describe(a)} · Detailed: ${describe(b)}`));}
   for(const [id,label] of [['original','Original'],['detailed','Detailed'],['swipe','Swipe'],['side','Side by side']])compareBar.append(action(label,()=>{n.properties??={};n.properties.if_compare_mode=id;dirty();n._cpmSuiteRender?.();},(n.properties?.if_compare_mode||'detailed')===id?'active':''));
 }
 right.append(compareBar);
 const preview=html('div','if-preview');displayCompare(n,preview);right.append(preview);
 if(!sampling){
   const gallery=html('div','if-gallery');for(let i=0;i<(n._ifImages||[]).length;i++){const pair=n._ifImages[i];const b=action('',()=>{n._ifSelected=i;n._cpmSuiteRender?.();},i===(n._ifSelected||0)?'active':'');const img=html('img');img.addEventListener('error',()=>b.remove(),{once:true});img.src=imageUrl(pair.detailed);b.append(img);gallery.append(b);}right.append(gallery);
 }
 const statusLine=html('div','if-status',sampling?'Sampling in progress… compare and save controls will return once finishing completes.':(n._ifSaveMessage||'Images are temporary until you choose Save'));right.append(statusLine);
 const saveRow=html('div','if-save'),folder=html('div','if-folder'),folderCtl=html('select');const current=n.properties?.if_output_folder||'';const folders=n._ifFolders||[''];for(const key of folders){const o=html('option','',key||'output /');o.value=key;folderCtl.append(o);}if(!folders.includes(current)){const o=html('option','',current.startsWith('native:')?(n.properties?.if_native_folder_label||'Windows folder'):`${current} (missing)`);o.value=current;folderCtl.append(o);}folderCtl.value=current;folderCtl.title=n.properties?.if_native_folder_label||'Destination inside ComfyUI/output';folderCtl.addEventListener('change',()=>{n.properties??={};n.properties.if_output_folder=folderCtl.value;dirty();});folder.append(folderCtl,action('📂',()=>browseFolder(n)),action('+',()=>createFolder(n)));saveRow.append(folder);
 const format=html('select','if-format');for(const f of ['PNG','JPEG','WEBP','TIFF','BMP','GIF']){const option=html('option','',f);option.value=f;format.append(option);}format.value=n.properties?.if_export_format||'PNG';format.title='Export image format';format.addEventListener('change',()=>{n.properties??={};n.properties.if_export_format=format.value;dirty();});saveRow.append(format);
 const buttons=html('div','if-save-actions');for(const [key,label] of [['original','Save Original'],['detailed','Save Detailed'],['all','Save All']]){const b=action(label,()=>saveChoice(n,key),key==='all'?'if-primary':'');b.disabled=sampling||!sourcePair(n)||(!enabled&&key!=='original')||(n._ifPreviewEnabled===false&&key!=='original');buttons.append(b);}saveRow.append(buttons);const autoLabel=html('label','if-autosave');const autoCheck=html('input');autoCheck.type='checkbox';autoCheck.checked=Boolean(n.properties?.if_autosave);autoCheck.disabled=sampling;autoCheck.addEventListener('change',()=>{n.properties??={};n.properties.if_autosave=autoCheck.checked;dirty();});autoLabel.append(autoCheck,html('span','','Autosave'));autoLabel.title='Automatically save detailed images after a successful Finisher run';saveRow.append(autoLabel);right.append(saveRow);
}
export function installFinisher(node,{root:providedRoot=null,combined=false}={}){if(node._ifInstalled)return;node._ifInstalled=true;node._ifCombined=combined;ifStyles();if(typeof node.addDOMWidget!=='function'){console.warn('[Image Finisher] Custom DOM widgets unavailable');return;}
 node.properties??={};node._ifImages=Array.isArray(node.properties.if_preview_pairs)?node.properties.if_preview_pairs:node._ifImages;node._ifPreviewEnabled=node.properties.if_preview_enabled;node._ifSamplerPreviewActive=Boolean(node._ifSamplerPreviewActive);node._ifSamplerPreviewURL=node._ifSamplerPreviewURL||'';node._ifSamplerProgressLabel=node._ifSamplerProgressLabel||'';if(node.properties.if_compare_mode==null)node.properties.if_compare_mode='detailed';const root=providedRoot||html('div','if-root');root.classList.add('if-root');for(const event of ['pointerdown','mousedown','dblclick'])root.addEventListener(event,ev=>ev.stopPropagation());if(!providedRoot){const dom=node.addDOMWidget('image_finisher_studio','custom',root,{serialize:false,hideOnZoom:false,margin:0,getHeight:()=>Math.max(610,(node.size?.[1]||700)-80),getMinHeight:()=>610,getMaxHeight:()=>1700});dom.serialize=false;}node._ifRoot=root;syncExtraSockets(node);removeNativePreview(node);
 const hidden=['settings_json','seed','face','eyes','hands','upscale_using_model','simple_upscale','mirror','watermark','diffusion_refine','enabled'];for(const key of hidden)hideWidget(get(node,key));node._ifStatus={value:''};node._cpmSuiteRender=()=>renderStudio(node);if(!combined)node.setSize?.([Math.max(900,node.size?.[0]||0),Math.max(720,node.size?.[1]||0)]);IF_NODES.set(String(node.id),node);
 const previousDrawBackground=node.onDrawBackground;node.onDrawBackground=function(...args){removeNativePreview(this);return previousDrawBackground?.apply(this,args);};const previousDrawForeground=node.onDrawForeground;node.onDrawForeground=function(...args){removeNativePreview(this);return previousDrawForeground?.apply(this,args);};const prior=node.onConfigure;node.onConfigure=function(...args){const r=prior?.apply(this,args);this._ifImages=Array.isArray(this.properties?.if_preview_pairs)?this.properties.if_preview_pairs:this._ifImages;this._ifSelected=0;this._ifSamplerPreviewActive=Boolean(this._ifSamplerPreviewActive);this._ifSamplerPreviewURL=this._ifSamplerPreviewURL||'';this._ifSamplerProgressLabel=this._ifSamplerProgressLabel||'';queueMicrotask(()=>{for(const key of hidden)hideWidget(get(this,key));IF_NODES.set(String(this.id),this);syncExtraSockets(this);removeNativePreview(this);this._cpmSuiteRender?.();});return r;};const oldRemoved=node.onRemoved;node.onRemoved=function(...args){IF_NODES.delete(String(node.id));return oldRemoved?.apply(this,args);};renderStudio(node);loadFolders(node);
}
let eventsStarted=false;function startEvents(){if(eventsStarted)return;eventsStarted=true;
 api.addEventListener('executed',ev=>{const d=ev.detail||{},id=String(d.display_node??d.node??'');const n=IF_NODES.get(id)||app.graph?.getNodeById?.(Number(id));if(!n||!isFinisherType(n.type))return;const output=d.output||{};if(Array.isArray(output.if_images)){removeNativePreview(n);n._ifImages=output.if_images;n.properties??={};n.properties.if_preview_pairs=output.if_images;n._ifSelected=0;n._ifPreviewEnabled=output.if_enabled?.[0]!==false;n.properties.if_preview_enabled=n._ifPreviewEnabled;n._ifSummary=output.if_summary?.[0]||'Finished';n._ifSaveMessage='Ready — choose what to save';n._ifSamplerPreviewActive=false;n._ifSamplerProgressLabel='';n._cpmSuiteRender?.();if(n.properties?.if_autosave&&n._ifPreviewEnabled){autoSaveFinisher(n,output.if_images).catch(err=>{n._ifSaveMessage=`Autosave failed: ${err.message}`;n._cpmSuiteRender?.();});}}});
 api.addEventListener('executing',ev=>{const data=ev.detail||{},id=String(typeof data==='string'?data:data.display_node??data.node??'');const n=IF_NODES.get(id);if(n){removeNativePreview(n);n._ifSummary='Processing…';if(n._ifCombined){n._ifSamplerPreviewActive=true;n._ifSamplerPreviewURL='';n._ifSamplerProgressLabel='Starting sampler…';}n._cpmSuiteRender?.();}});
 api.addEventListener('progress',ev=>{const d=ev.detail||{},id=String(d.node??'');const n=IF_NODES.get(id);if(!n||!n._ifCombined||!n._ifSamplerPreviewActive)return;const cur=Number(d.value??0),total=Number(d.max??1);n._ifSamplerProgressLabel=total?`Step ${cur}/${total}`:'Sampling…';n._cpmSuiteRender?.();});
 api.addEventListener('direct_sampler_frame',ev=>{const d=ev.detail||{};const n=IF_NODES.get(String(d.node_id??''));if(!n||!n._ifCombined)return; if(typeof d.image==='string'&&d.image.length){n._ifSamplerPreviewActive=true;n._ifSamplerPreviewURL=`data:image/jpeg;base64,${d.image}`;n._ifSummary=n._ifSummary||'Sampling…';n._cpmSuiteRender?.();}});
 api.addEventListener('execution_error',ev=>{const d=ev.detail||{},n=IF_NODES.get(String(d.node_id??''));if(n){n._ifSamplerPreviewActive=false;n._ifSaveMessage=d.exception_message||'Finisher error';n._cpmSuiteRender?.();}});
}
startEvents();
app.registerExtension({name:'uninodes.image_finisher',async beforeRegisterNodeDef(type,data){if(data.name!==NODE_NAME)return;const previous=type.prototype.onNodeCreated;type.prototype.onNodeCreated=function(...args){const r=previous?.apply(this,args);installFinisher(this);return r;};}});
