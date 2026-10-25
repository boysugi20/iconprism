import './style.css';
import paper from 'paper/dist/paper-core';
import { Editor, isText, type Align, type BooleanOp, type Fill, type ToolName } from './editor';
import { buildZip, parseSizes, slug } from './export';
import { TEMPLATES } from './templates';
import { drawAdaptive, drawFull, loadImages } from './render';
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
  $('sel-title').textContent = n === 0 ? 'Nothing selected' : n === 1 ? kind : `${n} items`;
  $('sel-block').classList.toggle('empty', n === 0);
  $('fill-scope').textContent = n ? 'selection' : 'new shapes';

  const b = editor.selBounds();
  geo.forEach((g, i) => {
    g.disabled = !b;
    if (document.activeElement !== g) g.value = b ? String(round([b.x, b.y, b.width, b.height][i])) : '';
  });
  rot.disabled = !b;
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
    put('pv-ios', drawFull(imgs, 128, 'squircle'));
    put('pv-and', drawAdaptive(imgs, 128, 'squircle'));
    put('pv-round', drawAdaptive(imgs, 128, 'circle'));
    put('pv-32', drawFull(imgs, 32));
    put('pv-16', drawFull(imgs, 16));
  } catch (err) {
    console.error(err);
  }
}

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
$('templates').innerHTML = TEMPLATES.map(
  (t) => `<button type="button" class="tpl" data-tpl="${t.id}"><svg viewBox="0 0 64 64" aria-hidden="true">${t.thumb}</svg><b>${t.name}</b><span>${t.hint}</span></button>`,
).join('');
$('templates').addEventListener('click', async (e) => {
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
}
$('empty-template').addEventListener('click', () => openTemplates(false));

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
  $('ref-empty').hidden = has;
  $('ref-controls').hidden = !has;
  refOpacity.value = String(editor.reference.opacity);
  refShow.checked = editor.reference.visible;
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
  toast('Reference added. It sits under your shapes and is never exported.');
}

editor.onReference = syncReference;
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
    editor.setReference(saved.src);
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

// ---------------------------------------------------------------- wiring

const zoomLabel = $('zoom-fit');
editor.onChange = () => { syncPanel(); schedulePreview(); };
editor.onLive = () => { syncPanel(); schedulePreview(); };
editor.onSelect = syncPanel;
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
