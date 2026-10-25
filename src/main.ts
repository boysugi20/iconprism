import './style.css';
import paper from 'paper/dist/paper-core';
import { Editor, type Align, type BooleanOp, type Fill, type ToolName } from './editor';
import { buildZip, slug } from './export';
import { drawAdaptive, drawFull, loadImages } from './render';
import { hydrateIcons, icon } from './icons';

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
  { id: 'text', label: 'Text', key: 'T', hint: 'Click to place text. Text exports with a system font.' },
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
geo.forEach((input) =>
  input.addEventListener('change', () => {
    const [x, y, w, h] = geo.map((g) => Number(g.value));
    editor.setBounds({ x, y, w, h });
  }),
);

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

  const st = editor.currentStyle();
  fill.set(st.fill);
  sOn.checked = !!st.stroke.color;
  if (st.stroke.color) { sColor.value = st.stroke.color; sHex.value = st.stroke.color; }
  else sHex.value = sColor.value;
  sWidth.value = String(round(st.stroke.width));
  opacity.value = String(st.opacity);
  opacity.disabled = !n;

  bgOn.checked = editor.background.enabled;
  bgFill.set(editor.background.fill);
  $<HTMLButtonElement>('undo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('redo').disabled = !editor.canRedo;
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
$('new').addEventListener('click', () => {
  if (confirm('Start a new icon? This clears the artboard (Undo brings it back).')) editor.clearAll();
});
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
  const imgs = await loadImages(svgs());
  drawFull(imgs, 1024).toBlob((b) => b && download(b, `${slug(appName())}-icon-1024.png`), 'image/png');
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

// ---------------------------------------------------------------- wiring

const zoomLabel = $('zoom-fit');
editor.onChange = () => { syncPanel(); schedulePreview(); };
editor.onLive = () => { syncPanel(); schedulePreview(); };
editor.onSelect = syncPanel;
editor.onTool = syncTool;
editor.onView = () => (zoomLabel.textContent = `${Math.round(paper.view.zoom * 100)}%`);

const stage = $('stage');
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  editor.resize(width, height);
  editor.fit();
}).observe(stage);

syncTool();
syncPanel();
renderPreviews();

if (import.meta.env.DEV) Object.assign(window, { editor, paper, buildZip, svgs });
