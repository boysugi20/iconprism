import './style.css';
import paper from 'paper/dist/paper-core';
import { Editor, isText, type Align, type BooleanOp, type Fill, type ToolName } from './editor';
import { buildZip, parseSizes, slug } from './export';
import { TEMPLATES, type Template } from './templates';
import { buildMessages, chat, EXAMPLES, extractSvg, isReady, listModels, loadSettings, PROVIDERS, sanitizeSvg, saveSettings, suggestModel, type AiSettings } from './ai';
import { CATEGORIES, loadCatalog, loadWeight, searchIcons, WEIGHTS, withColor, type IconMeta, type IconWeight } from './iconlib';
import { drawAdaptive, drawFull, loadImages, type IconImages } from './render';
import { deviceHtml, type DeviceView, type PreviewImages } from './devices';
import { hydrateIcons, icon } from './icons';
import { addCustomFont, allFonts, fontInfo, loadFont, nearestWeight, WEIGHT_NAMES, type TextSpec } from './text';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const TOOLS: { id: ToolName; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Click to select, Shift to add. Drag handles to resize. Double-click a shape to edit its points.' },
  { id: 'node', label: 'Edit points', key: 'A', hint: 'Drag points and handles. Click an edge to add a point. Double-click a point for curve or corner. ⌫ deletes points.' },
  { id: 'rect', label: 'Rectangle', key: 'R', hint: 'Drag to draw. Shift for a square, Alt from the centre. Set corner radius in Shape tools.' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', hint: 'Drag to draw. Shift for a circle, Alt from the centre.' },
  { id: 'polygon', label: 'Polygon', key: 'Y', hint: 'Drag out from the centre. Set the number of sides in Shape tools.' },
  { id: 'star', label: 'Star', key: 'S', hint: 'Drag out from the centre. Set the number of points in Shape tools.' },
  { id: 'line', label: 'Line', key: 'L', hint: 'Drag to draw. Shift snaps to 45°. Uses the stroke colour and width.' },
  { id: 'pen', label: 'Pen', key: 'P', hint: 'Click for corners, drag for curves. Click the first point to close, Enter to finish.' },
  { id: 'text', label: 'Text', key: 'T', hint: 'Click to type. Enter finishes, Shift+Enter adds a line, Esc cancels. Double-click text to edit it.' },
];

const canvas = $<HTMLCanvasElement>('canvas');
const editor = new Editor(canvas);

hydrateIcons();

// ---------------------------------------------------------------- toast

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- tools rail

const toolsEl = $('tools');
toolsEl.innerHTML = TOOLS.map(
  (t) => `<button data-tool="${t.id}" title="${t.label} (${t.key})" aria-label="${t.label}">${icon(t.id)}<kbd>${t.key}</kbd></button>`,
).join('');
toolsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
  if (b) editor.setTool(b.dataset.tool as ToolName);
});

function syncTool() {
  toolsEl.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === editor.tool));
  $('hint').textContent = TOOLS.find((t) => t.id === editor.tool)?.hint ?? '';
}

// ---------------------------------------------------------------- fill control

function fillControl(root: HTMLElement, onInput: (f: Fill, final: boolean) => void) {
  root.className = 'fill';
  root.innerHTML = `
    <div class="seg">
      <button data-v="none">None</button><button data-v="solid">Solid</button><button data-v="linear">Gradient</button>
    </div>
    <div class="row c1"><span class="color"><input type="color"><input class="hex" spellcheck="false" maxlength="7"></span></div>
    <div class="row c2"><span class="color"><input type="color"><input class="hex" spellcheck="false" maxlength="7"></span>
      <label class="num small" title="Gradient angle"><span>∠</span><input class="angle" type="number" step="15"></label></div>`;
  let f: Fill = { type: 'solid', color: '#ffffff', color2: '#000000', angle: 90 };
  const [c1, c2] = [root.querySelector<HTMLElement>('.c1')!, root.querySelector<HTMLElement>('.c2')!];
  const angle = root.querySelector<HTMLInputElement>('.angle')!;

  const render = () => {
    root.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.type));
    c1.hidden = f.type === 'none';
    c2.hidden = f.type !== 'linear';
    for (const [row, val] of [[c1, f.color], [c2, f.color2]] as const) {
      row.querySelector<HTMLInputElement>('input[type=color]')!.value = val;
      row.querySelector<HTMLInputElement>('.hex')!.value = val;
    }
    angle.value = String(f.angle);
  };
  const emit = (final: boolean) => { render(); onInput({ ...f }, final); };

  root.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
    b.addEventListener('click', () => { f.type = b.dataset.v as Fill['type']; emit(true); }),
  );
  for (const [row, key] of [[c1, 'color'], [c2, 'color2']] as const) {
    const picker = row.querySelector<HTMLInputElement>('input[type=color]')!;
    const hexIn = row.querySelector<HTMLInputElement>('.hex')!;
    picker.addEventListener('input', () => { f[key] = picker.value; emit(false); });
    picker.addEventListener('change', () => { f[key] = picker.value; emit(true); });
    hexIn.addEventListener('change', () => {
      const v = hexIn.value.trim().replace(/^#?/, '#');
      if (/^#[0-9a-f]{6}$/i.test(v)) { f[key] = v.toLowerCase(); emit(true); } else render();
    });
  }
  angle.addEventListener('change', () => { f.angle = Number(angle.value) || 0; emit(true); });

  return { set(next: Fill) { f = { ...next }; render(); } };
}

const fill = fillControl($('fill'), (f, final) => editor.setFill(f, final));
const bgFill = fillControl($('bg-fill'), (f, final) => editor.setBackground({ enabled: editor.background.enabled, fill: f }, final));

// ---------------------------------------------------------------- text

const textEl = $('text-edit');
const textBlock = $('text-block');
const tFont = $<HTMLSelectElement>('t-font');
const tWeight = $<HTMLSelectElement>('t-weight');
const tSize = $<HTMLInputElement>('t-size');
const tSpacing = $<HTMLInputElement>('t-spacing');
const tLine = $<HTMLInputElement>('t-line');
const tAlign = $('t-align');

/** The text being typed on the canvas, if any. */
let editing: { item: paper.CompoundPath | null; at: paper.Point; spec: TextSpec } | null = null;

function selectedText() {
  return editor.selection.filter(isText);
}

function currentTextSpec(): TextSpec {
  return editing?.spec ?? selectedText()[0]?.data.text ?? editor.newText;
}

function syncTextPanel() {
  const show = editor.tool === 'text' || !!editing || selectedText().length > 0;
  textBlock.hidden = !show;
  if (!show) return;
  const spec = currentTextSpec();
  $('text-scope').textContent = editing ? 'editing' : selectedText().length ? 'selection' : 'new text';
  tFont.innerHTML = allFonts().map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
  tFont.value = spec.font;
  const weights = fontInfo(spec.font)?.weights ?? [400];
  tWeight.innerHTML = weights.map((w) => `<option value="${w}">${WEIGHT_NAMES[w] ?? w}</option>`).join('');
  tWeight.value = String(nearestWeight(spec.font, spec.weight));
  tSize.value = String(spec.size);
  tSpacing.value = String(spec.spacing);
  tLine.value = String(spec.lineHeight);
  tAlign.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === spec.align));
  $<HTMLButtonElement>('t-convert').hidden = !selectedText().length || !!editing;
}

/** Positions and styles the on-canvas editor to match the outlines it will produce. */
async function styleTextEditor() {
  if (!editing) return;
  const ed = editing;
  const { font, family } = await loadFont(ed.spec.font, ed.spec.weight);
  if (editing !== ed) return;
  const scale = paper.view.zoom * (ed.item ? Math.abs(ed.item.matrix.scaling.y) : 1);
  const px = ed.spec.size * scale;
  const asc = font.ascender / font.unitsPerEm;
  const desc = -font.descender / font.unitsPerEm;
  const lineBox = ed.spec.lineHeight * px;
  const p = paper.view.projectToView(ed.at);
  const fill = ed.item ? ed.item.data.fill : editor.newFill;
  const shift = ed.spec.align === 'center' ? '-50%' : ed.spec.align === 'right' ? '-100%' : '0';
  Object.assign(textEl.style, {
    fontFamily: `"${family}"`,
    fontWeight: String(nearestWeight(ed.spec.font, ed.spec.weight)),
    fontSize: `${px}px`,
    lineHeight: `${lineBox}px`,
    letterSpacing: `${ed.spec.spacing / 1000}em`,
    textAlign: ed.spec.align,
    color: !fill || fill.type === 'none' ? '#ffffff' : fill.color,
    left: `${p.x}px`,
    top: `${p.y - (lineBox - (asc + desc) * px) / 2 - asc * px}px`,
    transform: `translateX(${shift})`,
  });
}

async function openTextEditor(req: { item: paper.CompoundPath | null; at: paper.Point }) {
  // A click outside while typing only finishes the current text.
  if (editing) { await commitText(); return; }
  const spec: TextSpec = req.item ? { ...req.item.data.text } : { ...editor.newText, content: '' };
  const ed = { item: req.item, at: req.item ? req.item.localToGlobal(new paper.Point(0, 0)) : req.at, spec };
  editing = ed;
  editor.hideForEditing(req.item);
  editor.select([]);
  textEl.textContent = spec.content;
  try {
    await styleTextEditor();
  } catch (err) {
    if (editing === ed) cancelText();
    toast((err as Error).message);
    return;
  }
  // Another click may have finished or replaced this edit while the font loaded.
  if (editing !== ed) return;
  textEl.hidden = false;
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  syncTextPanel();
}

function closeTextEditor() {
  const ed = editing;
  editing = null;
  textEl.hidden = true;
  editor.hideForEditing(null);
  return ed;
}

async function commitText() {
  const content = textEl.innerText.replace(/\n$/, '');
  const ed = closeTextEditor();
  if (!ed) return;
  if (!ed.item) editor.newText = { ...ed.spec, content: '' };
  try {
    await editor.writeText(ed.item, ed.at, { ...ed.spec, content });
  } catch (err) {
    toast((err as Error).message);
  }
  syncPanel();
}

function cancelText() {
  const ed = closeTextEditor();
  if (ed?.item) editor.select([ed.item]);
  paper.view.update();
  syncPanel();
}

textEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
});
textEl.addEventListener('focusout', (e) => {
  // Tweaking the Text panel keeps the editor open.
  if ((e.relatedTarget as HTMLElement | null)?.closest('#text-block')) return;
  if (editing) commitText();
});

function setText(patch: Partial<TextSpec>) {
  if (patch.font) patch.weight = nearestWeight(patch.font, patch.weight ?? currentTextSpec().weight);
  if (editing) {
    editing.spec = { ...editing.spec, ...patch };
    styleTextEditor().catch((err) => toast(err.message));
    syncTextPanel();
    textEl.focus();
    return;
  }
  editor.updateText(patch).then(syncPanel, (err) => toast(err.message));
  syncTextPanel();
}

tFont.addEventListener('change', () => setText({ font: tFont.value }));
tWeight.addEventListener('change', () => setText({ weight: Number(tWeight.value) }));
tSize.addEventListener('change', () => setText({ size: Math.max(8, Number(tSize.value) || 8) }));
tSpacing.addEventListener('change', () => setText({ spacing: Number(tSpacing.value) || 0 }));
tLine.addEventListener('change', () => setText({ lineHeight: Math.max(0.5, Number(tLine.value) || 1) }));
tAlign.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b) setText({ align: b.dataset.v as TextSpec['align'] });
});
$<HTMLInputElement>('t-upload').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const id = await addCustomFont(file);
    setText({ font: id, weight: fontInfo(id)!.weights[0] });
    toast(`Added ${fontInfo(id)!.name.replace(' (uploaded)', '')}. Re-upload it after a reload to edit this text.`);
  } catch {
    toast('Could not read that font. Use .ttf, .otf or .woff.');
  }
});
$('t-convert').addEventListener('click', () => { editor.convertToShape(); syncPanel(); });

// ---------------------------------------------------------------- stroke + layout

const sOn = $<HTMLInputElement>('s-on');
const sColor = $<HTMLInputElement>('s-color');
const sHex = $<HTMLInputElement>('s-hex');
const sWidth = $<HTMLInputElement>('s-width');

function emitStroke(final: boolean) {
  editor.setStroke({ color: sOn.checked ? sColor.value : null, width: Number(sWidth.value) || 0 }, final);
  syncPanel();
}
sOn.addEventListener('change', () => emitStroke(true));
sColor.addEventListener('input', () => { sOn.checked = true; emitStroke(false); });
sColor.addEventListener('change', () => emitStroke(true));
sHex.addEventListener('change', () => {
  const v = sHex.value.trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{6}$/i.test(v)) { sColor.value = v; sOn.checked = true; }
  emitStroke(true);
});
sWidth.addEventListener('change', () => emitStroke(true));

const geo = ['f-x', 'f-y', 'f-w', 'f-h'].map((id) => $<HTMLInputElement>(id));
const keepRatio = $<HTMLInputElement>('f-ratio');
geo.forEach((input, i) =>
  input.addEventListener('change', () => {
    const b = editor.selBounds();
    if (!b) return;
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) { syncPanel(); return; }
    // Only the edited field changes; the others keep their exact (unrounded) values.
    let [x, y, w, h] = [b.x, b.y, b.width, b.height];
    if (i === 0) x = v;
    if (i === 1) y = v;
    if (i === 2) w = v;
    if (i === 3) h = v;
    // With Keep ratio on, typing one side scales the other to match.
    if (keepRatio.checked && b.width && b.height) {
      if (i === 2) h = (w / b.width) * b.height;
      if (i === 3) w = (h / b.height) * b.width;
    }
    editor.setBounds({ x, y, w, h });
  }),
);
const rot = $<HTMLInputElement>('f-rot');
rot.addEventListener('change', () => {
  const v = Number(rot.value);
  if (Number.isFinite(v)) editor.rotate(v - editor.rotation);
  syncPanel();
});

const opacity = $<HTMLInputElement>('f-opacity');
opacity.addEventListener('input', () => editor.setOpacity(Number(opacity.value), false));
opacity.addEventListener('change', () => editor.setOpacity(Number(opacity.value), true));

const dRadius = $<HTMLInputElement>('d-radius');
const dSides = $<HTMLInputElement>('d-sides');
dRadius.value = String(editor.cornerRadius);
dSides.value = String(editor.sides);
dRadius.addEventListener('change', () => (editor.cornerRadius = Math.max(0, Number(dRadius.value) || 0)));
dSides.addEventListener('change', () => (editor.sides = Math.min(64, Math.max(3, Math.round(Number(dSides.value) || 3)))));

// ---------------------------------------------------------------- background + guides

const bgOn = $<HTMLInputElement>('bg-on');
bgOn.addEventListener('change', () => editor.setBackground({ enabled: bgOn.checked, fill: editor.background.fill }));
const guideIds = { ios: 'g-ios', android: 'g-android', center: 'g-center' } as const;
for (const [key, id] of Object.entries(guideIds)) {
  const el = $<HTMLInputElement>(id);
  el.checked = editor.guides[key as keyof typeof guideIds];
  el.addEventListener('change', () => editor.setGuides({ ...editor.guides, [key]: el.checked }));
}

// ---------------------------------------------------------------- panel sync

const round = (n: number) => Math.round(n * 10) / 10;

function syncPanel() {
  const n = editor.selection.length;
  const kind = n === 1 ? editor.selection[0].className.replace('PointText', 'Text').replace('CompoundPath', 'Compound shape').replace('Path', 'Shape') : 'items';
  $('sel-title').textContent = editor.refEditing ? 'Reference image' : n === 0 ? 'Nothing selected' : n === 1 ? kind : `${n} items`;
  $('sel-block').classList.toggle('empty', n === 0 && !editor.refEditing);
  $('fill-scope').textContent = n ? 'selection' : 'new shapes';

  const b = editor.selBounds();
  geo.forEach((g, i) => {
    g.disabled = !b;
    if (document.activeElement !== g) g.value = b ? String(round([b.x, b.y, b.width, b.height][i])) : '';
  });
  rot.disabled = !b || editor.refEditing;
  if (document.activeElement !== rot) rot.value = b ? String(editor.rotation) : '';

  const st = editor.currentStyle();
  fill.set(st.fill);
  sOn.checked = !!st.stroke.color;
  if (st.stroke.color) { sColor.value = st.stroke.color; sHex.value = st.stroke.color; }
  else sHex.value = sColor.value;
  sWidth.value = String(round(st.stroke.width));
  opacity.value = String(st.opacity);
  opacity.disabled = !n;

  syncTextPanel();
  bgOn.checked = editor.background.enabled;
  bgFill.set(editor.background.fill);
  $<HTMLButtonElement>('undo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('redo').disabled = !editor.canRedo;
  $('empty').hidden = editor.layers().length > 0 || !!editing;
  syncLayers();
}

// ---------------------------------------------------------------- previews

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreviews, 120);
}

function svgs() {
  return {
    full: editor.toSVG('full'),
    bg: editor.background.enabled ? editor.toSVG('background') : null,
    bgBleed: editor.background.enabled ? editor.toSVG('background-bleed') : null,
    fg: editor.toSVG('foreground'),
  };
}

async function renderPreviews() {
  try {
    const imgs = await loadImages(svgs());
    const put = (id: string, c: HTMLCanvasElement) => {
      const el = $<HTMLCanvasElement>(id);
      const ctx = el.getContext('2d')!;
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.drawImage(c, 0, 0, el.width, el.height);
    };
    put('mini-ios', drawFull(imgs, 96, 'squircle'));
    put('mini-round', drawAdaptive(imgs, 96, 'circle'));
    put('mini-fav', drawFull(imgs, 32));
    if (deviceDialog.open) renderDevices(imgs);
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------- device preview

const deviceDialog = $<HTMLDialogElement>('device-dialog');
const deviceName = $<HTMLInputElement>('device-name');
let deviceView: DeviceView = 'iphone';
let deviceTheme: 'light' | 'dark' = 'light';

function previewImages(imgs: IconImages): PreviewImages {
  const url = (c: HTMLCanvasElement) => c.toDataURL('image/png');
  return {
    ios: url(drawFull(imgs, 240, 'squircle')),
    circle: url(drawAdaptive(imgs, 216, 'circle')),
    squircle: url(drawAdaptive(imgs, 216, 'squircle')),
    rounded: url(drawAdaptive(imgs, 216, 'rounded')),
    square: url(drawFull(imgs, 216, 'none', editor.background.enabled ? undefined : '#ffffff')),
    favicon: url(drawFull(imgs, 32)),
  };
}

async function renderDevices(imgs?: IconImages) {
  $('device-view').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === deviceView));
  $('device-theme').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === deviceTheme));
  const stage = $('device-stage');
  stage.dataset.theme = deviceTheme;
  stage.innerHTML = deviceHtml(deviceView, previewImages(imgs ?? (await loadImages(svgs()))), deviceName.value);
}

function openDevices() {
  editor.finishPen();
  deviceName.value = appName();
  deviceDialog.showModal();
  renderDevices().catch((err) => toast((err as Error).message));
}

$('device-view').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  deviceView = b.dataset.v as DeviceView;
  renderDevices();
});
$('device-theme').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  deviceTheme = b.dataset.v as 'light' | 'dark';
  renderDevices();
});
deviceName.addEventListener('input', () => {
  // One app name everywhere: the export dialog uses it too.
  $<HTMLInputElement>('x-name').value = deviceName.value;
  renderDevices();
});
$('mini-preview').addEventListener('click', openDevices);
$('preview-btn').addEventListener('click', openDevices);

// ---------------------------------------------------------------- commands

const commands: Record<string, () => void> = {
  'rotate-ccw': () => editor.rotate(-15),
  'rotate-cw': () => editor.rotate(15),
  'flip-h': () => editor.flip('h'),
  'flip-v': () => editor.flip('v'),
  front: () => editor.arrange('front'),
  forward: () => editor.arrange('forward'),
  backward: () => editor.arrange('backward'),
  back: () => editor.arrange('back'),
  group: () => editor.group(),
  ungroup: () => editor.ungroup(),
  duplicate: () => editor.duplicate(),
  delete: () => editor.remove(),
};
for (const op of ['unite', 'subtract', 'intersect', 'exclude'] as BooleanOp[])
  commands[op] = () => { if (!editor.boolean(op)) toast('Select two or more shapes first (not text or groups).'); };
for (const a of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as Align[]) commands[`align-${a}`] = () => editor.align(a);

document.querySelector('.panel')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cmd]');
  if (!b) return;
  if (!editor.selection.length) { toast('Select something first.'); return; }
  commands[b.dataset.cmd!]?.();
});

$('undo').addEventListener('click', () => editor.undo());
$('redo').addEventListener('click', () => editor.redo());
$('new').addEventListener('click', () => openTemplates(false));
$('zoom-in').addEventListener('click', () => editor.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => editor.zoomBy(0.8));
$('zoom-fit').addEventListener('click', () => editor.fit());

$<HTMLInputElement>('import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    editor.importSVG(await file.text());
    toast(`Imported ${file.name}`);
  } catch (err) {
    toast((err as Error).message || 'Could not import that SVG.');
  }
});

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const appName = () => $<HTMLInputElement>('x-name').value || 'My App';

$('dl-svg').addEventListener('click', () => download(new Blob([editor.toSVG()], { type: 'image/svg+xml' }), `${slug(appName())}-icon.svg`));
$('dl-png').addEventListener('click', async () => {
  try {
    const imgs = await loadImages(svgs());
    drawFull(imgs, 1024).toBlob((b) => b && download(b, `${slug(appName())}-icon-1024.png`), 'image/png');
  } catch (err) {
    console.error(err);
    toast('Could not render the PNG.');
  }
});

// ---------------------------------------------------------------- export dialog

const dialog = $<HTMLDialogElement>('export-dialog');
$('export').addEventListener('click', () => {
  editor.finishPen();
  $('x-note').textContent = editor.background.enabled
    ? ''
    : 'The background is off. iOS and store icons cannot be transparent, so they get a solid colour behind the artwork.';
  dialog.showModal();
});
$('x-go').addEventListener('click', async (e) => {
  e.preventDefault();
  const opts = {
    name: appName(),
    ios: $<HTMLInputElement>('x-ios').checked,
    android: $<HTMLInputElement>('x-android').checked,
    web: $<HTMLInputElement>('x-web').checked,
    opaqueColor: '#ffffff',
    iosVariants: $<HTMLInputElement>('x-ios-variants').checked,
    extraSizes: parseSizes($<HTMLInputElement>('x-sizes').value),
  };
  if (!opts.ios && !opts.android && !opts.web) { toast('Pick at least one platform.'); return; }
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    download(await buildZip(svgs(), opts), `${slug(opts.name)}-icons.zip`);
    dialog.close();
    toast('Icon set downloaded.');
  } catch (err) {
    console.error(err);
    toast('Export failed. See the console for details.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
});

$('x-copy-svg').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.toSVG());
    toast('SVG code copied.');
  } catch {
    toast('Copy failed. Use the SVG button to download it instead.');
  }
});

// ---------------------------------------------------------------- templates

const tplDialog = $<HTMLDialogElement>('template-dialog');
const tplCard = (t: Template) =>
  `<button type="button" class="tpl" data-tpl="${t.id}"><svg viewBox="0 0 64 64" aria-hidden="true">${t.thumb}</svg><b>${t.name}</b><span>${t.hint}</span></button>`;
$('templates-ready').innerHTML = TEMPLATES.filter((t) => t.group === 'ready').map(tplCard).join('');
$('templates-basic').innerHTML = TEMPLATES.filter((t) => t.group === 'basic').map(tplCard).join('');

const svgInner = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** Draws previews for icon templates once their icon weight has loaded. */
let thumbsDrawn = false;
async function drawTemplateThumbs() {
  if (thumbsDrawn) return;
  thumbsDrawn = true;
  for (const t of TEMPLATES) {
    if (!t.icon) continue;
    const icons = await loadWeight(t.icon.weight);
    const svg = icons.get(t.icon.name);
    const el = document.querySelector(`[data-tpl="${t.id}"] svg`);
    if (!svg || !el) continue;
    const bg = t.background.fill;
    const plate = t.plate
      ? t.plate.shape === 'circle'
        ? `<circle cx="32" cy="32" r="${32 * t.plate.size}" fill="${t.plate.color}"/>`
        : `<rect x="${32 - 32 * t.plate.size}" y="${32 - 32 * t.plate.size}" width="${64 * t.plate.size}" height="${64 * t.plate.size}" rx="${14 * t.plate.size}" fill="${t.plate.color}"/>`
      : '';
    // Same placement as the editor: the icon's real bounds fill `fit` of the square, centred.
    // The icon colour goes on a wrapping <g>, since Phosphor puts it on the root <svg> we strip.
    el.innerHTML =
      `<defs><linearGradient id="tg-${t.id}" x2="0" y2="1"><stop stop-color="${bg.color}"/><stop offset="1" stop-color="${bg.color2}"/></linearGradient></defs>` +
      `<rect width="64" height="64" rx="14" fill="url(#tg-${t.id})"/>${plate}` +
      `<svg width="64" height="64" viewBox="0 0 256 256"><g fill="${t.icon.color}">${svgInner(svg)}</g></svg>`;
    const inner = el.lastElementChild as SVGSVGElement;
    const box = (inner.firstElementChild as SVGGElement).getBBox();
    if (box.width && box.height) {
      const side = Math.max(box.width, box.height) / t.icon.fit;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      inner.setAttribute('viewBox', `${cx - side / 2} ${cy - side / 2} ${side} ${side}`);
    }
  }
}

$('template-dialog').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tpl]');
  const t = TEMPLATES.find((x) => x.id === b?.dataset.tpl);
  if (!t) return;
  tplDialog.close();
  if (editing) cancelText();
  try {
    await editor.applyTemplate(t);
  } catch (err) {
    toast((err as Error).message);
  }
});

function openTemplates(welcome: boolean) {
  $('tpl-title').textContent = welcome ? 'Welcome to iconprism' : 'Start a new icon';
  $('tpl-sub').textContent = welcome
    ? 'Draw an app icon, then export every size for iOS, Android and the web. Pick a starting point; you can change everything afterwards.'
    : 'Pick a starting point. This replaces the artboard, and Undo brings back what you had.';
  tplDialog.showModal();
  drawTemplateThumbs().catch(() => { thumbsDrawn = false; });
}
$('empty-template').addEventListener('click', () => openTemplates(false));

// ---------------------------------------------------------------- icon library

const iconsDialog = $<HTMLDialogElement>('icons-dialog');
const iconGrid = $('icon-grid');
const iconSearch = $<HTMLInputElement>('icon-search');
const iconColor = $<HTMLInputElement>('icon-color');
const iconHex = $<HTMLInputElement>('icon-hex');
const PAGE = 180;
let iconWeight: IconWeight = 'fill';
let iconCategory: string | null = null;
let iconLimit = PAGE;
let iconResults: IconMeta[] = [];

$('icon-weight').innerHTML = WEIGHTS.map((w) => `<button type="button" data-v="${w.id}">${w.label}</button>`).join('');
$('icon-cats').innerHTML =
  `<button type="button" class="chip on" data-cat="">All</button>` +
  CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${c.id}">${c.label}</button>`).join('');

async function renderIcons() {
  $('icon-weight').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === iconWeight));
  $('icon-cats').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', (b.dataset.cat || null) === iconCategory));
  iconGrid.classList.add('loading');
  try {
    const [catalog, svgs] = await Promise.all([loadCatalog(), loadWeight(iconWeight)]);
    iconResults = searchIcons(catalog, iconSearch.value, iconCategory).filter((i) => svgs.has(i.name));
    const shown = iconResults.slice(0, iconLimit);
    iconGrid.innerHTML = shown.length
      ? shown
          .map((i) => `<button type="button" class="ic" data-icon-name="${i.name}" title="${esc(i.label)}" role="option">${svgs.get(i.name)}<span>${esc(i.label)}</span></button>`)
          .join('') + (iconResults.length > shown.length ? `<button type="button" class="more-icons" id="icons-more">Show more (${iconResults.length - shown.length} left)</button>` : '')
      : `<p class="muted">No icons match “${esc(iconSearch.value)}”. Try a simpler word, like heart, money or chat.</p>`;
  } catch {
    iconGrid.innerHTML = '<p class="muted">Could not load the icon library. Check your connection and try again.</p>';
  } finally {
    iconGrid.classList.remove('loading');
  }
}

let searchTimer = 0;
iconSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { iconLimit = PAGE; renderIcons(); }, 120);
});
$('icon-weight').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  iconWeight = b.dataset.v as IconWeight;
  renderIcons();
});
$('icon-cats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  iconCategory = b.dataset.cat || null;
  iconLimit = PAGE;
  renderIcons();
});
const setIconColor = (v: string) => {
  iconColor.value = v;
  iconHex.value = v.toUpperCase();
  iconGrid.style.color = v;
};
iconColor.addEventListener('input', () => setIconColor(iconColor.value));
iconHex.addEventListener('change', () => {
  const v = iconHex.value.trim().replace(/^#?/, '#');
  setIconColor(/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : iconColor.value);
});

iconGrid.addEventListener('click', async (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('#icons-more')) { iconLimit += PAGE; renderIcons(); return; }
  const name = el.closest<HTMLButtonElement>('[data-icon-name]')?.dataset.iconName;
  if (!name) return;
  const svg = (await loadWeight(iconWeight)).get(name);
  if (!svg) return;
  if (editing) cancelText();
  editor.importSVG(withColor(svg, iconColor.value), { fit: 0.56, fill: { type: 'solid', color: iconColor.value, color2: '#ffffff', angle: 90 }, name });
  if (!(e as MouseEvent).shiftKey) iconsDialog.close();
  toast('Icon added. Change its colour in Fill, or select it with other shapes to combine them.');
});

function openIcons() {
  // Start from the current fill colour so the icon matches the rest of the design.
  const f = editor.selection.length ? null : editor.newFill;
  if (f && f.type !== 'none') setIconColor(f.color);
  else setIconColor(iconColor.value);
  iconsDialog.showModal();
  iconSearch.focus();
  iconSearch.select();
  renderIcons();
}
$('icons-btn').addEventListener('click', openIcons);
$('empty-icons').addEventListener('click', openIcons);

// ---------------------------------------------------------------- help + snap

const helpDialog = $<HTMLDialogElement>('help-dialog');
$('help').addEventListener('click', () => helpDialog.showModal());
$('empty-help').addEventListener('click', () => helpDialog.showModal());
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.key === '?' && !t.closest('input, textarea, select, [contenteditable], dialog[open]')) helpDialog.showModal();
});

const snapBtn = $('snap');
snapBtn.addEventListener('click', () => {
  editor.snapOn = !editor.snapOn;
  snapBtn.classList.toggle('on', editor.snapOn);
  snapBtn.setAttribute('aria-pressed', String(editor.snapOn));
});

// ---------------------------------------------------------------- panel tabs + layers

const layersEl = $('layers');
let showingLayers = false;
function setTab(layers: boolean) {
  showingLayers = layers;
  $('tab-design').classList.toggle('on', !layers);
  $('tab-layers').classList.toggle('on', layers);
  $('tab-design').setAttribute('aria-selected', String(!layers));
  $('tab-layers').setAttribute('aria-selected', String(layers));
  $('design-pane').hidden = layers;
  $('layers-pane').hidden = !layers;
  syncLayers();
}
$('tab-design').addEventListener('click', () => setTab(false));
$('tab-layers').addEventListener('click', () => setTab(true));

function layerName(item: paper.Item): string {
  if (item.name) return item.name;
  if (isText(item)) return `“${(item.data.text as TextSpec).content.split('\n')[0].slice(0, 24)}”`;
  if (item instanceof paper.Group) return `Group (${item.children.length})`;
  if (item instanceof paper.CompoundPath) return 'Compound shape';
  if (item instanceof paper.Path) return item.closed ? 'Shape' : 'Line';
  return item.className;
}

function layerKind(item: paper.Item) {
  return isText(item) ? 'text' : item instanceof paper.Group ? 'group' : item instanceof paper.Path && !item.closed ? 'line' : 'shape';
}

const KIND_ICON: Record<string, string> = { text: 'text', group: 'node', line: 'line', shape: 'polygon' };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function syncLayers() {
  const items = editor.layers();
  $('layer-count').textContent = items.length ? String(items.length) : '';
  if (!showingLayers || layersEl.querySelector('[contenteditable]')) return;
  layersEl.innerHTML = items.length
    ? items
        .map(
          (it) => `<li draggable="true" data-id="${it.id}" class="${editor.selection.includes(it) ? 'on' : ''} ${it.visible ? '' : 'off'} ${it.locked ? 'locked' : ''}">
            <i class="kind">${icon(KIND_ICON[layerKind(it)])}</i>
            <span class="name">${esc(layerName(it))}</span>
            <button class="icon-btn mini" data-act="vis" title="${it.visible ? 'Hide' : 'Show'}">${icon(it.visible ? 'eye' : 'eyeOff')}</button>
            <button class="icon-btn mini" data-act="lock" title="${it.locked ? 'Unlock' : 'Lock'}">${icon(it.locked ? 'lock' : 'unlock')}</button>
          </li>`,
        )
        .join('')
    : '<li class="none">No layers yet. Draw something on the artboard.</li>';
}

const itemById = (id: string | undefined) => editor.layers().find((i) => String(i.id) === id);

layersEl.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const li = el.closest<HTMLLIElement>('li[data-id]');
  const item = itemById(li?.dataset.id);
  if (!item) return;
  const act = el.closest<HTMLButtonElement>('[data-act]')?.dataset.act;
  if (act === 'vis') return editor.setItemVisible(item, !item.visible);
  if (act === 'lock') return editor.setItemLocked(item, !item.locked);
  if (!item.visible || item.locked) { toast('Show and unlock this layer to select it.'); return; }
  if (e.shiftKey) editor.select(editor.selection.includes(item) ? editor.selection.filter((i) => i !== item) : [...editor.selection, item]);
  else editor.select([item]);
});

layersEl.addEventListener('dblclick', (e) => {
  const name = (e.target as HTMLElement).closest<HTMLElement>('.name');
  const li = name?.closest<HTMLLIElement>('li[data-id]');
  const item = itemById(li?.dataset.id);
  if (!name || !item) return;
  name.contentEditable = 'plaintext-only';
  name.focus();
  getSelection()?.selectAllChildren(name);
  const finish = (save: boolean) => {
    name.removeAttribute('contenteditable');
    if (save) editor.renameItem(item, name.textContent ?? '');
    else syncLayers();
  };
  name.addEventListener('keydown', (k) => {
    k.stopPropagation();
    if (k.key === 'Enter') { k.preventDefault(); name.blur(); }
    if (k.key === 'Escape') { name.dataset.cancel = '1'; name.blur(); }
  });
  name.addEventListener('blur', () => finish(!name.dataset.cancel), { once: true });
});

let dragId: string | null = null;
layersEl.addEventListener('dragstart', (e) => {
  dragId = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]')?.dataset.id ?? null;
  e.dataTransfer?.setData('text/plain', dragId ?? '');
});
layersEl.addEventListener('dragover', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
  if (!li || !dragId) return;
  e.preventDefault();
  const r = li.getBoundingClientRect();
  layersEl.querySelectorAll('.drop-above, .drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
  li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
});
layersEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
  const item = itemById(dragId ?? undefined);
  const target = itemById(li?.dataset.id);
  dragId = null;
  if (!li || !item || !target || item === target) { syncLayers(); return; }
  // The list shows the top of the stack first, so "above" in the list means higher in the stack.
  const others = editor.layers().reverse().filter((i) => i !== item);
  const t = others.indexOf(target);
  editor.moveItem(item, li.classList.contains('drop-above') ? t + 1 : t);
});
layersEl.addEventListener('dragend', () => { dragId = null; syncLayers(); });

// ---------------------------------------------------------------- reference image

const REF_KEY = 'iconprism:ref';
const refOpacity = $<HTMLInputElement>('ref-opacity');
const refShow = $<HTMLInputElement>('ref-show');

function syncReference() {
  const has = !!editor.reference.src;
  $('ref-btn').querySelector<HTMLElement>('.dot')!.hidden = !has;
  if (!has) closeMenus();
  refOpacity.value = String(editor.reference.opacity);
  $('ref-opacity-val').textContent = `${Math.round(editor.reference.opacity * 100)}%`;
  refShow.checked = editor.reference.visible;
  $('ref-bar').hidden = !editor.refEditing;
  $('ref-move').classList.toggle('on', editor.refEditing);
}

function saveReference() {
  try {
    if (editor.reference.src) localStorage.setItem(REF_KEY, JSON.stringify(editor.reference));
    else localStorage.removeItem(REF_KEY);
  } catch {
    toast('The reference image is too large to keep after a reload, but you can use it now.');
  }
}

function readImage(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

async function setReferenceFile(file: File | undefined) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Pick an image file (PNG, JPG, WebP, GIF or SVG).'); return; }
  editor.setReference(await readImage(file));
  saveReference();
  // Open the controls right away so opacity, move and resize are easy to find.
  const menu = $('ref-menu');
  closeMenus(menu);
  menu.hidden = false;
  $('ref-btn').setAttribute('aria-expanded', 'true');
}

editor.onReference = syncReference;
editor.onReferenceChange = saveReference;
$('ref-move').addEventListener('click', () => {
  closeMenus();
  editor.editReference(!editor.refEditing);
});
$('ref-done').addEventListener('click', () => editor.editReference(false));
$('ref-fit').addEventListener('click', () => editor.fitReference('contain'));
$('ref-fill').addEventListener('click', () => editor.fitReference('cover'));
for (const id of ['ref-file', 'ref-replace']) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    setReferenceFile(input.files?.[0]);
    input.value = '';
  });
}
refOpacity.addEventListener('input', () => { editor.setReferenceStyle(Number(refOpacity.value), refShow.checked); });
refOpacity.addEventListener('change', saveReference);
refShow.addEventListener('change', () => { editor.setReferenceStyle(Number(refOpacity.value), refShow.checked); saveReference(); });
$('ref-remove').addEventListener('click', () => { editor.setReference(null); saveReference(); });

try {
  const saved = JSON.parse(localStorage.getItem(REF_KEY) ?? 'null');
  if (saved?.src) {
    editor.setReferenceStyle(saved.opacity ?? 0.4, saved.visible ?? true);
    editor.setReference(saved.src, Array.isArray(saved.matrix) ? saved.matrix : null);
  }
} catch { /* ignore a broken saved reference */ }
syncReference();

// ---------------------------------------------------------------- drag and drop

const drop = $('drop');
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; drop.hidden = false; } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    try {
      editor.importSVG(await file.text());
      toast(`Imported ${file.name}`);
    } catch (err) {
      toast((err as Error).message);
    }
  } else if (/\.(ttf|otf|woff)$/i.test(file.name)) {
    toast('To use a font, select the text tool and press Upload font.');
  } else {
    setReferenceFile(file);
  }
});

// ---------------------------------------------------------------- AI

const aiDialog = $<HTMLDialogElement>('ai-dialog');
const aiSettingsDialog = $<HTMLDialogElement>('ai-settings');
const aiPrompt = $<HTMLTextAreaElement>('ai-prompt');
const aiGo = $<HTMLButtonElement>('ai-go');
const aiStatus = $('ai-status');
let aiSettings: AiSettings | null = loadSettings();
let aiMode: 'generate' | 'edit' = 'generate';
let aiRun: AbortController | null = null;
let aiResult: string | null = null;
let openAiAfterSettings = false;

const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

function syncAiDialog() {
  $('ai-mode').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === aiMode));
  const empty = editor.layers().length === 0;
  $('ai-mode').querySelector<HTMLButtonElement>('[data-v="edit"]')!.disabled = empty;
  aiPrompt.placeholder =
    aiMode === 'edit'
      ? 'Say what to change, e.g. make it a blue gradient, round the corners, make the bolt bigger'
      : 'Describe the icon, e.g. a friendly cloud with a lightning bolt, blue gradient';
  aiGo.textContent = aiRun ? 'Cancel' : aiMode === 'edit' ? 'Apply change' : 'Generate';
  aiGo.classList.toggle('primary', !aiRun);
  $('ai-model-line').innerHTML = aiSettings
    ? `Using <b>${esc(aiSettings.model)}</b> via ${esc(providerOf(aiSettings.provider).name)}. Each request is billed to your account by your provider.`
    : '';
}

$('ai-examples').innerHTML = EXAMPLES.map((e) => `<button type="button" class="chip">${esc(e)}</button>`).join('');
$('ai-examples').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  aiMode = 'generate';
  aiPrompt.value = b.textContent ?? '';
  syncAiDialog();
  aiPrompt.focus();
});
$('ai-mode').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b || b.disabled) return;
  aiMode = b.dataset.v as 'generate' | 'edit';
  syncAiDialog();
});

async function runAi() {
  if (aiRun) { aiRun.abort(); return; }
  if (!isReady(aiSettings)) { openAiSettings(true); return; }
  const request = aiPrompt.value.trim();
  if (!request) { toast(aiMode === 'edit' ? 'Say what to change first.' : 'Describe the icon first.'); aiPrompt.focus(); return; }
  const settings = aiSettings;
  aiRun = new AbortController();
  $('ai-result').hidden = true;
  const started = Date.now();
  const tick = window.setInterval(() => (aiStatus.textContent = `Drawing… ${Math.round((Date.now() - started) / 1000)} s. This can take up to a minute.`), 500);
  aiStatus.textContent = 'Drawing…';
  syncAiDialog();
  try {
    const messages = buildMessages(aiMode, request, aiMode === 'edit' ? editor.toSVG() : undefined);
    const reply = await chat(settings, messages, aiRun.signal);
    const svg = extractSvg(reply);
    if (!svg) throw new Error('The model answered without an SVG. Try again, or pick a stronger model in AI settings.');
    aiResult = sanitizeSvg(svg);
    // Shown through <img> so nothing in the SVG can run, even after sanitising.
    const holder = $('ai-preview');
    const old = holder.querySelector('img');
    if (old) URL.revokeObjectURL(old.src);
    const img = new Image();
    img.alt = '';
    img.src = URL.createObjectURL(new Blob([aiResult], { type: 'image/svg+xml' }));
    holder.replaceChildren(img);
    $('ai-result').hidden = false;
    $('ai-add').hidden = aiMode === 'edit';
    aiStatus.textContent = `Done in ${Math.round((Date.now() - started) / 1000)} s.`;
  } catch (err) {
    aiStatus.textContent = (err as Error).name === 'AbortError' ? 'Cancelled.' : (err as Error).message;
  } finally {
    clearInterval(tick);
    aiRun = null;
    syncAiDialog();
  }
}

aiGo.addEventListener('click', runAi);
aiPrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runAi(); }
});
$('ai-retry').addEventListener('click', runAi);

function useAiResult(mode: 'replace' | 'add') {
  if (!aiResult) return;
  if (editing) cancelText();
  try {
    editor.placeIconSvg(aiResult, mode);
    aiDialog.close();
    toast(mode === 'replace' ? 'Icon placed. Undo brings back what you had.' : 'Artwork added on top.');
  } catch (err) {
    toast((err as Error).message);
  }
}
$('ai-apply').addEventListener('click', () => useAiResult('replace'));
$('ai-add').addEventListener('click', () => useAiResult('add'));

function openAi() {
  if (!isReady(aiSettings)) { openAiSettings(true); return; }
  if (editor.layers().length === 0) aiMode = 'generate';
  syncAiDialog();
  aiDialog.showModal();
  aiPrompt.focus();
}
$('ai-btn').addEventListener('click', openAi);
$('ai-settings-btn').addEventListener('click', () => { aiDialog.close(); openAiSettings(true); });
aiDialog.addEventListener('close', () => aiRun?.abort());

// AI settings
const aiProvider = $<HTMLSelectElement>('ai-provider');
const aiBase = $<HTMLInputElement>('ai-base');
const aiKey = $<HTMLInputElement>('ai-key');
const aiModel = $<HTMLInputElement>('ai-model');
const aiRemember = $<HTMLInputElement>('ai-remember');
const aiTestStatus = $('ai-test-status');
aiProvider.innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

function formSettings(): AiSettings {
  return { provider: aiProvider.value, baseUrl: aiBase.value.trim(), apiKey: aiKey.value.trim(), model: aiModel.value.trim(), remember: aiRemember.checked };
}

function syncProvider(resetUrl: boolean) {
  const p = providerOf(aiProvider.value);
  $('ai-provider-note').textContent = p.note;
  if (resetUrl) aiBase.value = p.baseUrl;
  $('ai-base-field').hidden = !!p.baseUrl && p.id !== 'custom' && !p.baseUrl.includes('localhost');
  const link = $<HTMLAnchorElement>('ai-key-link');
  link.hidden = !p.keyUrl;
  if (p.keyUrl) link.href = p.keyUrl;
  aiKey.placeholder = p.needsKey ? 'Paste your API key' : 'Not needed for this provider';
}

function openAiSettings(thenOpenAi: boolean) {
  openAiAfterSettings = thenOpenAi;
  const s = aiSettings;
  aiProvider.value = s?.provider ?? 'openrouter';
  syncProvider(!s);
  if (s) {
    aiBase.value = s.baseUrl;
    aiKey.value = s.apiKey;
    aiModel.value = s.model;
    aiRemember.checked = s.remember;
  } else {
    aiKey.value = '';
    aiModel.value = '';
    aiRemember.checked = false;
  }
  aiTestStatus.textContent = '';
  aiSettingsDialog.showModal();
  // OpenRouter lists its models without a key, so the model box can fill in right away.
  if (!s && aiProvider.value === 'openrouter') loadModels(true);
}

aiProvider.addEventListener('change', () => {
  syncProvider(true);
  aiModel.value = '';
  $('ai-models').innerHTML = '';
  aiTestStatus.textContent = '';
  if (aiProvider.value === 'openrouter') loadModels(true);
});

async function loadModels(quiet = false) {
  aiTestStatus.textContent = 'Loading models…';
  try {
    const ids = await listModels(formSettings());
    $('ai-models').innerHTML = ids.map((id) => `<option value="${esc(id)}"></option>`).join('');
    if (!aiModel.value) aiModel.value = suggestModel(ids);
    aiTestStatus.textContent = `${ids.length} models available. Type to search the list.`;
  } catch (err) {
    aiTestStatus.textContent = quiet ? '' : (err as Error).message;
  }
}
$('ai-load-models').addEventListener('click', () => loadModels());

$('ai-test').addEventListener('click', async () => {
  const s = formSettings();
  if (!isReady(s)) { aiTestStatus.textContent = 'Fill in the key and model first.'; return; }
  aiTestStatus.textContent = 'Testing…';
  try {
    await chat(s, [{ role: 'user', content: 'Reply with the single word: ok' }]);
    aiTestStatus.textContent = 'Connected.';
  } catch (err) {
    aiTestStatus.textContent = (err as Error).message;
  }
});

$('ai-save').addEventListener('click', (e) => {
  e.preventDefault();
  const s = formSettings();
  const p = providerOf(s.provider);
  if (!s.baseUrl) { aiTestStatus.textContent = 'Enter the base URL.'; return; }
  if (p.needsKey && !s.apiKey) { aiTestStatus.textContent = 'Paste your API key.'; return; }
  if (!s.model) { aiTestStatus.textContent = 'Choose a model (press Load models).'; return; }
  aiSettings = s;
  saveSettings(s);
  aiSettingsDialog.close();
  if (openAiAfterSettings) openAi();
});

// ---------------------------------------------------------------- top bar menus

// Phone menu: each item clicks the real control, so behaviour stays in one place.
// Registered before the generic menu handlers so it can stop them closing a panel it just opened.
$('more-menu').addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('[data-proxy]');
  if (!item) return;
  e.stopImmediatePropagation();
  closeMenus();
  document.getElementById(item.dataset.proxy!)?.click();
});

function closeMenus(except?: HTMLElement) {
  document.querySelectorAll<HTMLElement>('.menu').forEach((m) => {
    if (m === except) return;
    m.hidden = true;
    document.querySelector(`[data-menu="${m.id}"]`)?.setAttribute('aria-expanded', 'false');
    if (m.id === 'ref-menu') $('ref-btn').setAttribute('aria-expanded', 'false');
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) =>
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $(btn.dataset.menu!);
    closeMenus(menu);
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  }),
);
// Picking an item (or a file) closes the menu; clicks elsewhere and Esc do too.
document.querySelectorAll('.menu').forEach((m) => {
  m.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) closeMenus(); });
  m.addEventListener('change', (e) => { if ((e.target as HTMLInputElement).type === 'file') closeMenus(); });
  m.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if ((k.key === 'Enter' || k.key === ' ') && (k.target as HTMLElement).matches('label')) {
      k.preventDefault();
      (k.target as HTMLElement).querySelector('input')?.click();
    }
  });
});
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.menu')) closeMenus(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
$('dl-set').addEventListener('click', () => $('export').click());

// No reference yet: the button picks a file. With one: it opens Show, Fade, Replace and Remove.
$('ref-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!editor.reference.src) { $<HTMLInputElement>('ref-file').click(); return; }
  const menu = $('ref-menu');
  closeMenus(menu);
  menu.hidden = !menu.hidden;
  $('ref-btn').setAttribute('aria-expanded', String(!menu.hidden));
});

// ---------------------------------------------------------------- wiring

const zoomLabel = $('zoom-fit');
editor.onChange = () => { syncPanel(); schedulePreview(); };
editor.onLive = () => { syncPanel(); schedulePreview(); };
editor.onSelect = () => { syncPanel(); syncReference(); };
editor.onTool = () => { syncTool(); syncTextPanel(); };
editor.onView = () => {
  zoomLabel.textContent = `${Math.round(paper.view.zoom * 100)}%`;
  if (editing) styleTextEditor().catch((err) => toast(err.message));
};
editor.onBeforeHistory = () => { if (editing) cancelText(); };
// Clicking the canvas while typing finishes the text first.
canvas.addEventListener('pointerdown', () => { if (editing && !textEl.hidden) commitText(); }, true);
editor.onEditText = (req) => { openTextEditor(req); };
editor.onNotice = toast;

const stage = $('stage');
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  editor.resize(width, height);
  editor.fit();
}).observe(stage);

syncTool();
syncPanel();
renderPreviews();
if (!editor.hadSavedDoc) openTemplates(true);

if (import.meta.env.DEV) Object.assign(window, { editor, paper, buildZip, svgs });
