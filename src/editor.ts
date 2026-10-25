import paper from 'paper/dist/paper-core';
import { DEFAULT_TEXT, loadFont, nearestWeight, textPathData, type TextSpec } from './text';

/** Artboard size in project units. Everything is designed at 1024 x 1024. */
export const ART = 1024;
export const ACCENT = '#e4ff4f';
const STORAGE_KEY = 'iconprism:doc';

export type ToolName = 'select' | 'node' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'pen' | 'text';
export type FillType = 'none' | 'solid' | 'linear';
export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude';
export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface Fill {
  type: FillType;
  color: string;
  color2: string;
  /** Gradient direction in degrees; 90 runs top to bottom. */
  angle: number;
}
export interface Stroke {
  color: string | null;
  width: number;
}
export interface Background {
  enabled: boolean;
  fill: Fill;
}
export interface Guides {
  ios: boolean;
  android: boolean;
  center: boolean;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Drag =
  | { kind: 'move'; moved: boolean; start?: paper.Rectangle; raw?: paper.Point; applied?: paper.Point }
  | { kind: 'scale'; handle: Handle; anchor: paper.Point; start: paper.Rectangle; fx: number; fy: number }
  | { kind: 'marquee'; from: paper.Point; to: paper.Point; add: boolean }
  | { kind: 'create'; from: paper.Point; item: paper.Item | null }
  | { kind: 'segments'; moved: boolean }
  | { kind: 'handle'; segment: paper.Segment; which: 'in' | 'out' }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'pen' };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const OPPOSITE: Record<Handle, Handle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

function handlePoint(b: paper.Rectangle, h: Handle): paper.Point {
  switch (h) {
    case 'nw': return b.topLeft;
    case 'n': return b.topCenter;
    case 'ne': return b.topRight;
    case 'e': return b.rightCenter;
    case 'se': return b.bottomRight;
    case 's': return b.bottomCenter;
    case 'sw': return b.bottomLeft;
    case 'w': return b.leftCenter;
  }
}

/** Modifier keys from the native mouse event; Paper's own key tracking can miss key-ups. */
function mods(e: paper.ToolEvent) {
  const n = (e as unknown as { event?: MouseEvent }).event;
  return { shift: !!n?.shiftKey, alt: !!n?.altKey, noSnap: !!(n?.metaKey || n?.ctrlKey) };
}

export function isText(item: paper.Item | null | undefined): item is paper.CompoundPath {
  const t = item?.data?.text;
  return item instanceof paper.CompoundPath && !!t && typeof t.content === 'string' && typeof t.font === 'string';
}

export const solid = (color: string): Fill => ({ type: 'solid', color, color2: '#ffffff', angle: 90 });

/** Paints an item with a fill spec and remembers the spec so the panel can show it again. */
export function applyFill(item: paper.Item, f: Fill) {
  item.data.fill = { ...f };
  if (f.type === 'none') {
    item.fillColor = null;
  } else if (f.type === 'solid') {
    item.fillColor = new paper.Color(f.color);
  } else {
    // Items that keep their own matrix (text) take gradient points in local space.
    const b = item.applyMatrix ? item.bounds : item.internalBounds;
    const a = (f.angle * Math.PI) / 180;
    const dir = new paper.Point(Math.cos(a), Math.sin(a));
    const half = (Math.abs(dir.x) * b.width + Math.abs(dir.y) * b.height) / 2;
    item.fillColor = new paper.Color({
      gradient: { stops: [f.color, f.color2] },
      origin: b.center.subtract(dir.multiply(half)),
      destination: b.center.add(dir.multiply(half)),
    } as unknown as string);
  }
}

function hex(c: paper.Color | null | undefined): string {
  if (!c) return '#000000';
  if (c.gradient) return hex(c.gradient.stops[0].color);
  return c.toCSS(true);
}

/** Reads the fill spec back from an item, including items imported from SVG. */
export function readFill(item: paper.Item): Fill {
  const stored = item.data?.fill as Fill | undefined;
  const c = item.fillColor;
  if (stored) {
    // Rotate and flip turn the real gradient, so trust its live direction over the stored angle.
    const g = c as unknown as { gradient?: unknown; origin?: paper.Point; destination?: paper.Point } | null;
    if (stored.type === 'linear' && g?.gradient && g.origin && g.destination)
      return { ...stored, angle: Math.round(g.destination.subtract(g.origin).angle) };
    return { ...stored };
  }
  if (!c) return { type: 'none', color: '#ffffff', color2: '#000000', angle: 90 };
  if (c.gradient) {
    const stops = c.gradient.stops;
    const g = c as unknown as { origin?: paper.Point; destination?: paper.Point };
    const angle = g.origin && g.destination ? Math.round(g.destination.subtract(g.origin).angle) : 90;
    return { type: 'linear', color: hex(stops[0].color), color2: hex(stops[stops.length - 1].color), angle };
  }
  return solid(hex(c));
}

/** Reads a solid or linear-gradient fill from an SVG element, for turning a background rect into the artboard background. */
function fillFromSvg(el: Element, doc: Document): Fill | null {
  // A see-through background rectangle stays a normal layer.
  for (const a of ['opacity', 'fill-opacity']) if (el.getAttribute(a) && parseFloat(el.getAttribute(a)!) < 1) return null;
  const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/.exec(el.getAttribute('style') ?? '')?.[1];
  const raw = (styleFill ?? el.getAttribute('fill') ?? '#000000').trim();
  const css = (c: string) => {
    try {
      return new paper.Color(c).toCSS(true);
    } catch {
      return null;
    }
  };
  const ref = /^url\(\s*['"]?#([^'")\s]+)/.exec(raw)?.[1];
  if (!ref) {
    const c = raw === 'none' ? null : css(raw);
    return c ? solid(c) : null;
  }
  const grad = doc.getElementById(ref);
  if (!grad || grad.localName !== 'linearGradient') return null;
  // Transformed gradients are hard to read back; keep such a rectangle as a normal layer instead.
  if (grad.getAttribute('gradientTransform')) return null;
  let stopsFrom: Element = grad;
  const href = (grad.getAttribute('href') ?? grad.getAttribute('xlink:href'))?.replace(/^#/, '');
  if (!grad.getElementsByTagName('stop').length && href) stopsFrom = doc.getElementById(href) ?? grad;
  const stops = [...stopsFrom.getElementsByTagName('stop')];
  const stopColor = (st: Element) =>
    css(/(?:^|;)\s*stop-color\s*:\s*([^;]+)/.exec(st.getAttribute('style') ?? '')?.[1] ?? st.getAttribute('stop-color') ?? '#000000');
  if (stops.length < 2) return null;
  const a = stopColor(stops[0]);
  const b = stopColor(stops[stops.length - 1]);
  if (!a || !b) return null;
  const num = (name: string, d: number) => {
    const v = grad.getAttribute(name);
    if (v == null) return d;
    return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  };
  const angle = Math.round((Math.atan2(num('y2', 0) - num('y1', 0), num('x2', 1) - num('x1', 0)) * 180) / Math.PI);
  return { type: 'linear', color: a, color2: b, angle };
}

const RESERVED_IDS = new Set(['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']);

/**
 * Light clean-up for SVG files people import: removes scripts, foreign content and remote images
 * (which would load from the network), event handlers and data-* attributes, and renames ids that
 * clash with JavaScript object keys, which Paper uses as names.
 */
function cleanSvgForImport(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return svg;
  const renames = new Map<string, string>();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const name = el.localName.toLowerCase();
    if (['script', 'foreignobject', 'iframe', 'object', 'embed', 'style'].includes(name)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) {
      const n = attr.localName.toLowerCase();
      const v = attr.value.trim();
      if (n.startsWith('on') || n.startsWith('data-')) el.removeAttributeNode(attr);
      else if (n === 'href' && !v.startsWith('#') && !(name === 'image' && v.startsWith('data:image/'))) el.removeAttributeNode(attr);
      else if (n === 'id' && (RESERVED_IDS.has(v) || /^\d+$/.test(v))) {
        renames.set(v, `id-${v}`);
        attr.value = `id-${v}`;
      }
    }
    if (name === 'image' && !el.getAttribute('href') && !el.getAttribute('xlink:href')) el.remove();
  }
  let out = new XMLSerializer().serializeToString(root);
  for (const [from, to] of renames) out = out.split(`#${from})`).join(`#${to})`).split(`"#${from}"`).join(`"#${to}"`);
  return out;
}

export class Editor {
  tool: ToolName = 'select';
  selection: paper.Item[] = [];
  background: Background = {
    enabled: true,
    fill: { type: 'linear', color: '#2a2a31', color2: '#0d0d10', angle: 90 },
  };
  guides: Guides = { ios: true, android: false, center: false };
  /** Style for new shapes, edited in the panel while nothing is selected. */
  newFill: Fill = solid(ACCENT);
  newStroke: Stroke = { color: null, width: 24 };
  cornerRadius = 0;
  sides = 6;

  /** Document changed and was committed to history. */
  onChange = () => {};
  /** Something moved mid-gesture; previews may refresh. */
  onLive = () => {};
  onSelect = () => {};
  onTool = () => {};
  onView = () => {};
  /** Text tool click or double-click on text: the UI opens the on-canvas editor. */
  onEditText = (_req: { item: paper.CompoundPath | null; at: paper.Point }) => {};
  onNotice = (_msg: string) => {};
  /** Called before undo or redo, so the UI can close the text editor first. */
  onBeforeHistory = () => {};
  newText: TextSpec = { ...DEFAULT_TEXT };

  private board: paper.Layer;
  private bgLayer: paper.Layer;
  private bgRect: paper.Path;
  private content: paper.Layer;
  private guideLayer: paper.Layer;
  /** In-progress pen path: shown on canvas, never saved or exported until finished. */
  private draft: paper.Layer;
  private ui: paper.Layer;
  private refLayer: paper.Layer;
  private drag: Drag | null = null;
  /** Snap lines currently shown while dragging. */
  private snapGuides: { x: number[]; y: number[] } = { x: [], y: [] };
  /** Snap to the artboard and other shapes while moving, resizing and drawing. Hold ⌘/Ctrl to skip. */
  snapOn = true;
  /** False on a first visit, so the UI can offer templates. */
  hadSavedDoc = false;
  reference: { src: string | null; opacity: number; visible: boolean; matrix: number[] | null } = { src: null, opacity: 0.4, visible: true, matrix: null };
  /** True while the reference image is being moved or resized instead of the artwork. */
  refEditing = false;
  private penPath: paper.Path | null = null;
  private history: string[] = [];
  private hIndex = -1;
  private clipboard: paper.Item[] = [];
  private spaceDown = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    paper.setup(canvas);
    paper.settings.handleSize = 8;
    this.board = paper.project.activeLayer;
    this.bgLayer = new paper.Layer();
    this.bgRect = new paper.Path.Rectangle(new paper.Rectangle(0, 0, ART, ART));
    // Reference image for tracing: above the background, below the artwork, never exported.
    this.refLayer = new paper.Layer();
    this.refLayer.locked = true;
    this.content = new paper.Layer();
    // Paper draws selection in one flat colour, which vanishes on shapes of that colour.
    // Keep its selection state but draw the outline and points ourselves (see drawNodes).
    this.content.selectedColor = new paper.Color(0, 0, 0, 0);
    this.draft = new paper.Layer();
    this.guideLayer = new paper.Layer();
    this.guideLayer.locked = true;
    this.ui = new paper.Layer();
    this.ui.locked = true;
    this.drawBoard();
    this.content.activate();

    const tool = new paper.Tool();
    tool.onMouseDown = (e: paper.ToolEvent) => this.down(e);
    tool.onMouseDrag = (e: paper.ToolEvent) => this.dragMove(e);
    tool.onMouseUp = (e: paper.ToolEvent) => this.up(e);
    tool.onMouseMove = (e: paper.ToolEvent) => this.hover(e);

    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => this.doubleClickAt(paper.view.viewToProject(new paper.Point(e.offsetX, e.offsetY))));
    this.attachTouchGestures(canvas);
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });

    this.hadSavedDoc = this.restore();
    if (!this.hadSavedDoc) this.starter();
    this.applyBackground();
    this.drawGuides();
    this.commit();
  }

  // ---------------------------------------------------------------- document

  private drawBoard() {
    // Checkerboard under the artboard shows transparency.
    new paper.Path.Rectangle({ rectangle: new paper.Rectangle(0, 0, ART, ART), fillColor: '#ffffff', parent: this.board });
    const checks = new paper.CompoundPath({ parent: this.board, fillColor: '#e8e8e8' });
    const cell = 64;
    for (let y = 0; y < ART / cell; y++)
      for (let x = 0; x < ART / cell; x++)
        if ((x + y) % 2) checks.addChild(new paper.Path.Rectangle({ rectangle: new paper.Rectangle(x * cell, y * cell, cell, cell), insert: false }));
  }

  private starter() {
    const prism = new paper.Path.RegularPolygon(new paper.Point(512, 566), 3, 330);
    applyFill(prism, { type: 'linear', color: '#e4ff4f', color2: '#4ff0c8', angle: 60 });
    const beam = new paper.Path.RegularPolygon(new paper.Point(512, 566), 3, 120);
    applyFill(beam, solid('#0d0d10'));
  }

  applyBackground() {
    this.bgLayer.visible = this.background.enabled;
    applyFill(this.bgRect, this.background.fill);
  }

  setBackground(bg: Background, final = true) {
    this.background = { enabled: bg.enabled, fill: { ...bg.fill } };
    this.applyBackground();
    final ? this.commit() : this.onLive();
  }

  setGuides(g: Guides) {
    this.guides = { ...g };
    this.drawGuides();
  }

  private drawGuides() {
    const L = this.guideLayer;
    L.removeChildren();
    const art = new paper.Rectangle(0, 0, ART, ART);
    // Dim everything outside the artboard.
    new paper.CompoundPath({
      parent: L,
      children: [new paper.Path.Rectangle(new paper.Rectangle(-50000, -50000, 100000, 100000)), new paper.Path.Rectangle(art)],
      fillRule: 'evenodd',
      fillColor: new paper.Color(0.05, 0.05, 0.05, 0.78),
    });
    new paper.Path.Rectangle({ rectangle: art, parent: L, strokeColor: '#3a3a3a', strokeWidth: 1, strokeScaling: false });
    const guide = { strokeWidth: 1.5, strokeScaling: false, dashArray: [6, 4] };
    if (this.guides.ios)
      new paper.Path.Rectangle({ rectangle: art, radius: ART * 0.2237, parent: L, strokeColor: ACCENT, ...guide });
    if (this.guides.android)
      new paper.Path.Circle({ center: [ART / 2, ART / 2], radius: (ART / 2) * (66 / 72), parent: L, strokeColor: '#4ff0c8', ...guide });
    if (this.guides.center) {
      const c = { parent: L, strokeColor: '#ff5ec8', strokeWidth: 1, strokeScaling: false };
      new paper.Path.Line({ from: [ART / 2, 0], to: [ART / 2, ART], ...c });
      new paper.Path.Line({ from: [0, ART / 2], to: [ART, ART / 2], ...c });
    }
  }

  // ---------------------------------------------------------------- history

  /** Item hidden while its text is being typed on the canvas; saved as visible. */
  private editingHidden: paper.Item | null = null;
  /** Bumped whenever the whole document is replaced, so async work can tell it went stale. */
  private docVersion = 0;

  hideForEditing(item: paper.Item | null) {
    if (this.editingHidden && this.editingHidden !== item) this.editingHidden.visible = true;
    this.editingHidden = item;
    if (item) item.visible = false;
  }

  private serialize() {
    const hidden = this.editingHidden;
    if (hidden) hidden.visible = true;
    const content = this.content.exportJSON({ asString: false }) as unknown;
    if (hidden) hidden.visible = false;
    // Selection is UI state: keep it out of history so undo never lands on a no-op step.
    const strip = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      const props = node[1];
      if (props && typeof props === 'object' && !Array.isArray(props)) {
        delete (props as Record<string, unknown>).selected;
        const kids = (props as Record<string, unknown>).children;
        if (Array.isArray(kids)) kids.forEach(strip);
      }
    };
    strip(content);
    return JSON.stringify({ v: 1, background: this.background, content });
  }

  private load(snap: string) {
    const d = JSON.parse(snap);
    // Validate before touching anything, so a bad snapshot leaves the document as it was.
    if (d?.v !== 1 || !d.background?.fill || !Array.isArray(d.content)) throw new Error('Unrecognised document');
    const scratch = new paper.Layer({ insert: false });
    scratch.importJSON(d.content);
    this.editingHidden = null;
    this.content.removeChildren();
    this.content.addChildren(scratch.removeChildren());
    this.background = d.background;
    this.docVersion++;
    paper.project.deselectAll();
    this.applyBackground();
    this.select([]);
  }

  commit() {
    const snap = this.serialize();
    if (this.history[this.hIndex] !== snap) {
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push(snap);
      if (this.history.length > 100) this.history.shift();
      this.hIndex = this.history.length - 1;
      this.persist(snap);
    }
    this.drawUI();
    this.onChange();
  }

  undo() {
    this.editReference(false);
    this.finishPen();
    this.onBeforeHistory();
    if (this.hIndex <= 0) return;
    this.load(this.history[--this.hIndex]);
    this.persist(this.history[this.hIndex]);
    this.onChange();
  }

  redo() {
    this.editReference(false);
    this.finishPen();
    this.onBeforeHistory();
    if (this.hIndex >= this.history.length - 1) return;
    this.load(this.history[++this.hIndex]);
    this.persist(this.history[this.hIndex]);
    this.onChange();
  }

  get canUndo() { return this.hIndex > 0; }
  get canRedo() { return this.hIndex < this.history.length - 1; }

  private saveFailed = false;

  private persist(snap: string) {
    try {
      localStorage.setItem(STORAGE_KEY, snap);
      this.saveFailed = false;
    } catch {
      // Don't leave an older copy behind to be restored silently later.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
      if (!this.saveFailed) this.onNotice('Autosave failed: this icon is too large for browser storage. Export or download the SVG to keep it.');
      this.saveFailed = true;
    }
  }

  private restore(): boolean {
    try {
      const snap = localStorage.getItem(STORAGE_KEY);
      if (!snap) return false;
      this.load(snap);
      return true;
    } catch {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
      return false;
    }
  }

  /** Replaces the document with a template, as one undo step. */
  async applyTemplate(t: { background: Background; build(editor: Editor): Promise<void> | void }) {
    this.finishPen();
    this.hideForEditing(null);
    this.docVersion++;
    this.content.removeChildren();
    this.background = { enabled: t.background.enabled, fill: { ...t.background.fill } };
    this.applyBackground();
    this.content.activate();
    await t.build(this);
    this.setTool('select');
    this.select([]);
    this.commit();
  }

  clearAll() {
    this.finishPen();
    this.hideForEditing(null);
    this.docVersion++;
    this.content.removeChildren();
    this.select([]);
    this.commit();
  }

  // ---------------------------------------------------------------- selection

  select(items: paper.Item[]) {
    // Picking artwork ends reference adjusting, so commands never act on both at once.
    if (this.refEditing && items.length) this.editReference(false);
    paper.project.deselectAll();
    this.selection = items.filter((i) => i.parent === this.content);
    if (this.tool === 'node') this.selection.forEach((i) => (i.selected = true));
    this.drawUI();
    this.onSelect();
  }

  selectAll() {
    this.select(this.content.children.filter((c) => c.visible && !c.locked));
  }

  /** Selection in stacking order, bottom first. */
  private sorted() {
    return this.selection.slice().sort((a, b) => a.index - b.index);
  }

  private get refRaster(): paper.Raster | null {
    return (this.refLayer.firstChild as paper.Raster | null) ?? null;
  }

  /** What move, resize and the position fields act on: the reference image while it is being adjusted. */
  private get targets(): paper.Item[] {
    const r = this.refRaster;
    return this.refEditing && r ? [r] : this.selection;
  }

  selBounds(): paper.Rectangle | null {
    const t = this.targets;
    if (!t.length) return null;
    return t.map((i) => i.bounds).reduce((a, b) => a.unite(b));
  }

  private topItemAt(pt: paper.Point): paper.Item | null {
    const hit = this.content.hitTest(pt, { fill: true, stroke: true, segments: true, tolerance: 4 / paper.view.zoom });
    if (!hit) return null;
    let it: paper.Item = hit.item;
    while (it.parent && it.parent !== this.content) it = it.parent;
    return it.parent === this.content ? it : null;
  }

  private handleAt(pt: paper.Point): Handle | null {
    const b = this.tool === 'select' || this.refEditing ? this.selBounds() : null;
    if (!b) return null;
    const r = 7 / paper.view.zoom;
    return HANDLES.find((h) => handlePoint(b, h).getDistance(pt) <= r) ?? null;
  }

  /** Redraws selection box, handles, marquee and pen rubber band. */
  drawUI(extra?: { marquee?: paper.Rectangle; rubber?: [paper.Point, paper.Point] }) {
    const ui = this.ui;
    ui.removeChildren();
    const z = paper.view.zoom;
    const b = this.tool === 'select' || this.refEditing ? this.selBounds() : null;
    if (b) {
      if (this.targets.length > 1)
        for (const it of this.selection)
          new paper.Path.Rectangle({ rectangle: it.bounds, parent: ui, strokeColor: ACCENT, strokeWidth: 1, strokeScaling: false, opacity: 0.5 });
      new paper.Path.Rectangle({ rectangle: b, parent: ui, strokeColor: ACCENT, strokeWidth: 1.5, strokeScaling: false });
      const s = 8 / z;
      for (const h of HANDLES) {
        const p = handlePoint(b, h);
        new paper.Path.Rectangle({
          rectangle: new paper.Rectangle(p.x - s / 2, p.y - s / 2, s, s),
          parent: ui, fillColor: '#0d0d0d', strokeColor: ACCENT, strokeWidth: 1.5, strokeScaling: false,
        });
      }
    }
    if (extra?.marquee)
      new paper.Path.Rectangle({
        rectangle: extra.marquee, parent: ui, strokeColor: ACCENT, strokeWidth: 1, strokeScaling: false,
        dashArray: [4, 3], fillColor: new paper.Color(0.89, 1, 0.31, 0.08),
      });
    const span = 100000;
    for (const x of this.snapGuides.x)
      new paper.Path.Line({ from: [x, -span], to: [x, span], parent: ui, strokeColor: '#ff5ec8', strokeWidth: 1, strokeScaling: false });
    for (const y of this.snapGuides.y)
      new paper.Path.Line({ from: [-span, y], to: [span, y], parent: ui, strokeColor: '#ff5ec8', strokeWidth: 1, strokeScaling: false });
    if (this.tool === 'node') this.drawNodes();
    if (extra?.rubber)
      new paper.Path.Line({ from: extra.rubber[0], to: extra.rubber[1], parent: ui, strokeColor: ACCENT, strokeWidth: 1, strokeScaling: false, dashArray: [4, 3] });
  }

  /**
   * Edit-point overlay: a dark-and-light double outline plus white points with dark rims, so
   * points stay visible on any fill. Selected points are filled with the accent colour and show
   * their curve handles.
   */
  private drawNodes() {
    const ui = this.ui;
    const z = paper.view.zoom;
    const dark = new paper.Color(0.05, 0.05, 0.05, 0.9);
    for (const path of this.selectedPaths()) {
      const outline = path.clone({ insert: false, deep: false }) as paper.Path;
      outline.transform(path.parent?.globalMatrix ?? new paper.Matrix());
      for (const [color, width] of [[dark, 3], [new paper.Color('#4fb0ff'), 1.25]] as const) {
        const o = outline.clone({ insert: false });
        Object.assign(o, { fillColor: null, strokeColor: color, strokeWidth: width, strokeScaling: false, dashArray: [], opacity: 1, selected: false });
        ui.addChild(o);
      }
      for (const seg of path.segments) {
        const pt = path.localToGlobal(seg.point);
        if (seg.selected) {
          for (const h of [seg.handleIn, seg.handleOut]) {
            if (h.isZero()) continue;
            const hp = path.localToGlobal(seg.point.add(h));
            new paper.Path.Line({ from: pt, to: hp, parent: ui, strokeColor: '#4fb0ff', strokeWidth: 1, strokeScaling: false });
            new paper.Path.Circle({ center: hp, radius: 3.5 / z, parent: ui, fillColor: '#ffffff', strokeColor: dark, strokeWidth: 1.5, strokeScaling: false });
          }
        }
        const r = (seg.selected ? 5 : 4) / z;
        new paper.Path.Rectangle({
          rectangle: new paper.Rectangle(pt.x - r, pt.y - r, 2 * r, 2 * r),
          parent: ui,
          fillColor: seg.selected ? ACCENT : '#ffffff',
          strokeColor: dark,
          strokeWidth: 1.5,
          strokeScaling: false,
        });
      }
    }
  }

  // ---------------------------------------------------------------- tools

  setTool(t: ToolName) {
    if (this.refEditing && t !== 'select') this.editReference(false);
    if (this.tool === 'pen' && t !== 'pen') this.finishPen();
    this.tool = t;
    paper.project.deselectAll();
    if (t === 'node') this.selection.forEach((i) => (i.selected = true));
    this.drawUI();
    this.updateCursor();
    this.onTool();
  }

  private updateCursor() {
    const draw = ['rect', 'ellipse', 'polygon', 'star', 'line', 'pen'].includes(this.tool);
    this.canvas.style.cursor = this.spaceDown ? 'grab' : this.tool === 'text' ? 'text' : draw ? 'crosshair' : 'default';
  }

  private lastTap: { t: number; pt: paper.Point } | null = null;

  private down(e: paper.ToolEvent) {
    const native = (e as unknown as { event: MouseEvent }).event;
    // Touch screens have no dblclick: two quick taps in one place count as a double-click.
    if (typeof TouchEvent !== 'undefined' && native instanceof TouchEvent) {
      const now = Date.now();
      const last = this.lastTap;
      this.lastTap = { t: now, pt: e.point };
      if (last && now - last.t < 350 && last.pt.getDistance(e.point) < 24 / paper.view.zoom) {
        this.lastTap = null;
        this.doubleClickAt(e.point);
        return;
      }
    }
    if (this.spaceDown || native.button === 1) {
      this.drag = { kind: 'pan', x: native.clientX, y: native.clientY };
      return;
    }
    switch (this.tool) {
      case 'select': return this.selectDown(e);
      case 'node':
        this.nodeDown(e);
        this.drawUI();
        return;
      case 'pen': return this.penDown(e);
      case 'text': return this.textDown(e);
      default: this.drag = { kind: 'create', from: this.snapPoint(e.point, mods(e).noSnap), item: null };
    }
  }

  private dragMove(e: paper.ToolEvent) {
    const d = this.drag;
    if (!d) return;
    switch (d.kind) {
      case 'pan': {
        const native = (e as unknown as { event: MouseEvent }).event;
        const z = paper.view.zoom;
        paper.view.center = paper.view.center.subtract(new paper.Point((native.clientX - d.x) / z, (native.clientY - d.y) / z));
        d.x = native.clientX;
        d.y = native.clientY;
        this.drawUI();
        this.onView();
        return;
      }
      case 'move': {
        if (!d.start) {
          d.start = this.selBounds() ?? undefined;
          d.raw = new paper.Point(0, 0);
          d.applied = new paper.Point(0, 0);
        }
        if (!d.start || !d.raw || !d.applied) return;
        d.raw = d.raw.add(e.delta);
        let offset = d.raw;
        this.snapGuides = { x: [], y: [] };
        if (this.snapOn && !mods(e).noSnap) {
          const target = d.start.clone();
          target.point = target.point.add(d.raw);
          const lines = this.snapLines(new Set(this.targets));
          const sx = this.snapAxis([target.left, target.center.x, target.right], lines.x);
          const sy = this.snapAxis([target.top, target.center.y, target.bottom], lines.y);
          offset = offset.add(new paper.Point(sx?.delta ?? 0, sy?.delta ?? 0));
          if (sx) this.snapGuides.x.push(sx.line);
          if (sy) this.snapGuides.y.push(sy.line);
        }
        const step = offset.subtract(d.applied);
        this.targets.forEach((i) => i.translate(step));
        d.applied = offset;
        d.moved = true;
        this.drawUI();
        this.onLive();
        return;
      }
      case 'scale':
        return this.scaleDrag(d, e);
      case 'marquee':
        d.to = e.point;
        this.drawUI({ marquee: new paper.Rectangle(d.from, d.to) });
        return;
      case 'create':
        return this.createDrag(d, this.snapEvent(e));
      case 'segments':
        for (const p of this.selectedPaths())
          for (const s of p.segments) if (s.selected) s.point = s.point.add(e.delta);
        d.moved = true;
        this.drawUI();
        this.onLive();
        return;
      case 'handle': {
        const s = d.segment;
        const v = e.point.subtract(s.point);
        const other = d.which === 'out' ? s.handleIn : s.handleOut;
        const mirror = !mods(e).alt && !other.isZero() ? v.normalize(-other.length) : other;
        if (d.which === 'out') { s.handleOut = v; s.handleIn = mirror; } else { s.handleIn = v; s.handleOut = mirror; }
        this.drawUI();
        this.onLive();
        return;
      }
      case 'pen': {
        const s = this.penPath?.lastSegment;
        if (!s) return;
        s.handleOut = e.point.subtract(s.point);
        s.handleIn = s.handleOut.multiply(-1);
        return;
      }
    }
  }

  private up(e: paper.ToolEvent) {
    const d = this.drag;
    this.drag = null;
    if (this.snapGuides.x.length || this.snapGuides.y.length) {
      this.snapGuides = { x: [], y: [] };
      this.drawUI();
    }
    if (!d) return;
    switch (d.kind) {
      case 'move':
        if (d.moved) this.refEditing ? this.saveReference() : this.commit();
        return;
      case 'scale':
        return this.refEditing ? this.saveReference() : this.commit();
      case 'handle':
        return this.commit();
      case 'segments':
        if (d.moved) this.commit();
        return;
      case 'marquee': {
        const r = new paper.Rectangle(d.from, d.to);
        const hits = r.width < 2 && r.height < 2 ? [] : this.content.children.filter((c) => c.visible && !c.locked && r.intersects(c.bounds));
        this.select(d.add ? [...new Set([...this.selection, ...hits])] : hits);
        return;
      }
      case 'create': {
        let item = d.item;
        if (!item) {
          // A click without a drag drops a default-size shape.
          this.createDrag(d, e, true);
          item = d.item;
        }
        if (!item) return;
        this.setTool('select');
        this.select([item]);
        this.commit();
        return;
      }
    }
  }

  private hover(e: paper.ToolEvent) {
    if (this.tool === 'pen' && this.penPath && !this.drag) {
      this.drawUI({ rubber: [this.penPath.lastSegment.point, e.point] });
    } else if (this.tool === 'select' && !this.drag && !this.spaceDown) {
      const h = this.handleAt(e.point);
      const cursors: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
      this.canvas.style.cursor = h ? cursors[h] : 'default';
    }
  }

  private selectDown(e: paper.ToolEvent) {
    const h = this.handleAt(e.point);
    const b = this.selBounds();
    if (h && b) {
      this.drag = { kind: 'scale', handle: h, anchor: handlePoint(b, OPPOSITE[h]), start: b.clone(), fx: 1, fy: 1 };
      return;
    }
    if (this.refEditing) {
      // Only the reference image responds; the artwork stays put.
      if (b?.contains(e.point)) this.drag = { kind: 'move', moved: false };
      return;
    }
    const item = this.topItemAt(e.point);
    const shift = mods(e).shift;
    if (item) {
      if (shift) {
        this.select(this.selection.includes(item) ? this.selection.filter((i) => i !== item) : [...this.selection, item]);
      } else if (!this.selection.includes(item)) {
        this.select([item]);
      }
      this.drag = { kind: 'move', moved: false };
    } else {
      if (!shift) this.select([]);
      this.drag = { kind: 'marquee', from: e.point, to: e.point, add: shift };
    }
  }

  private scaleDrag(d: Extract<Drag, { kind: 'scale' }>, e: paper.ToolEvent) {
    e = this.snapEvent(e, new Set(this.selection));
    const hp = handlePoint(d.start, d.handle);
    const horiz = d.handle.includes('e') || d.handle.includes('w');
    const vert = d.handle.includes('n') || d.handle.includes('s');
    let fx = horiz && hp.x !== d.anchor.x ? (e.point.x - d.anchor.x) / (hp.x - d.anchor.x) : 1;
    let fy = vert && hp.y !== d.anchor.y ? (e.point.y - d.anchor.y) / (hp.y - d.anchor.y) : 1;
    if (mods(e).shift || this.refEditing) {
      // A flat selection (a horizontal or vertical line) scales by its one real axis.
      const flatX = !d.start.width;
      const flatY = !d.start.height;
      const f = horiz && vert && !flatX && !flatY ? Math.max(Math.abs(fx), Math.abs(fy)) : Math.abs(flatY || !vert ? fx : fy);
      fx = Math.sign(fx || 1) * f;
      fy = Math.sign(fy || 1) * f;
      if (!horiz) fx = f;
      if (!vert) fy = f;
    }
    const clamp = (v: number) => (Math.abs(v) < 0.01 ? 0.01 * Math.sign(v || 1) : v);
    fx = clamp(fx);
    fy = clamp(fy);
    this.targets.forEach((i) => i.scale(fx / d.fx, fy / d.fy, d.anchor));
    d.fx = fx;
    d.fy = fy;
    this.drawUI();
    this.onLive();
  }

  private createDrag(d: Extract<Drag, { kind: 'create' }>, e: paper.ToolEvent, click = false) {
    d.item?.remove();
    const from = d.from;
    let to = click ? from.add(new paper.Point(256, 256)) : e.point;
    let item: paper.Item;
    if (this.tool === 'line') {
      if (click) to = from.add(new paper.Point(256, 0));
      if (mods(e).shift) {
        const v = to.subtract(from);
        v.angle = Math.round(v.angle / 45) * 45;
        to = from.add(v);
      }
      item = new paper.Path.Line(from, to);
      this.styleNew(item, true);
    } else if (this.tool === 'polygon' || this.tool === 'star') {
      const r = Math.max(1, click ? 160 : to.getDistance(from));
      item = this.tool === 'polygon'
        ? new paper.Path.RegularPolygon(from, Math.max(3, this.sides), r)
        : new paper.Path.Star(from, Math.max(3, this.sides), r, r * 0.45);
      this.styleNew(item, false);
    } else {
      let w = to.x - from.x;
      let h = to.y - from.y;
      if (mods(e).shift) {
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      let rect = new paper.Rectangle(from, from.add(new paper.Point(w, h)));
      if (mods(e).alt && !click) rect = new paper.Rectangle(from.subtract(new paper.Point(w, h)), from.add(new paper.Point(w, h)));
      if (click) rect = new paper.Rectangle(from.subtract(new paper.Point(128, 128)), new paper.Size(256, 256));
      if (rect.width < 1 || rect.height < 1) { d.item = null; return; }
      item = this.tool === 'ellipse'
        ? new paper.Path.Ellipse(rect)
        : new paper.Path.Rectangle(rect, new paper.Size(Math.min(this.cornerRadius, rect.width / 2, rect.height / 2), Math.min(this.cornerRadius, rect.width / 2, rect.height / 2)));
      this.styleNew(item, false);
    }
    d.item = item;
  }

  /** Applies the current new-shape style. Lines and open paths get a stroke only. */
  private styleNew(item: paper.Item, open: boolean) {
    if (open) {
      applyFill(item, { ...this.newFill, type: 'none' });
      item.strokeColor = new paper.Color(this.newStroke.color ?? (this.newFill.type === 'none' ? '#ffffff' : this.newFill.color));
      item.strokeWidth = this.newStroke.width || 24;
      item.strokeCap = 'round';
      item.strokeJoin = 'round';
      return;
    }
    applyFill(item, this.newFill);
    if (this.newStroke.color) {
      item.strokeColor = new paper.Color(this.newStroke.color);
      item.strokeWidth = this.newStroke.width;
      item.strokeJoin = 'round';
    }
  }

  // Pen: click adds corners, drag pulls curve handles, clicking the first point closes the path.
  private penDown(e: paper.ToolEvent) {
    const p = this.penPath;
    if (p) {
      if (p.segments.length > 1 && e.point.getDistance(p.firstSegment.point) < 10 / paper.view.zoom) {
        p.closed = true;
        this.finishPen();
        return;
      }
      const pt = this.snapPoint(e.point, mods(e).noSnap);
      // The two clicks of a double-click (used to finish) must not add duplicate points.
      if (pt.getDistance(p.lastSegment.point) > 2 / paper.view.zoom) p.add(pt);
    } else {
      this.penPath = new paper.Path({ segments: [this.snapPoint(e.point, mods(e).noSnap)], strokeColor: ACCENT, strokeWidth: 1.5, strokeScaling: false, parent: this.draft });
    }
    this.drag = { kind: 'pen' };
  }

  finishPen() {
    const p = this.penPath;
    this.penPath = null;
    if (p) this.content.addChild(p);
    if (!p) return;
    this.drawUI();
    if (p.segments.length < 2) { p.remove(); return; }
    p.strokeScaling = true;
    p.strokeColor = null;
    p.strokeWidth = 1;
    this.styleNew(p, !p.closed);
    if (this.tool === 'pen') this.setTool('select');
    this.select([p]);
    this.commit();
  }

  private textDown(e: paper.ToolEvent) {
    const hit = this.topItemAt(e.point);
    this.onEditText(isText(hit) ? { item: hit, at: e.point } : { item: null, at: e.point });
  }

  /**
   * Creates or rewrites a text item from its spec. Text keeps its own matrix
   * (applyMatrix off), so moves, scales and rotations survive re-editing.
   */
  async writeText(
    item: paper.CompoundPath | null,
    at: paper.Point,
    spec: TextSpec,
    opts: { silent?: boolean; fill?: Fill } = {},
  ): Promise<paper.CompoundPath | null> {
    if (!spec.content.trim()) {
      if (item) {
        item.remove();
        this.select([]);
        this.commit();
      }
      return null;
    }
    spec = { ...spec, weight: nearestWeight(spec.font, spec.weight) };
    const version = this.docVersion;
    const { font } = await loadFont(spec.font, spec.weight);
    // The document changed while the font loaded (undo, delete, new): drop this write.
    if (version !== this.docVersion || (item && !item.parent)) return null;
    const d = textPathData(font, spec);
    if (!item || !item.parent) {
      this.content.activate();
      item = new paper.CompoundPath({ applyMatrix: false });
      item.translate(at);
      item.pathData = d;
      applyFill(item, opts.fill ?? (this.newFill.type === 'none' ? solid('#ffffff') : this.newFill));
    } else {
      item.pathData = d;
      if (item.data.fill?.type === 'linear') applyFill(item, item.data.fill);
    }
    item.data.text = { ...spec };
    if (opts.silent) return item;
    if (this.tool !== 'select') this.setTool('select');
    this.select([item]);
    this.commit();
    return item;
  }

  /** Applies a text setting to the selected text, or to new text when none is selected. */
  async updateText(patch: Partial<TextSpec>) {
    const items = this.selection.filter(isText);
    if (!items.length) {
      this.newText = { ...this.newText, ...patch };
      return;
    }
    for (const it of items) await this.writeText(it, it.position, { ...it.data.text, ...patch }, { silent: true });
    this.commit();
    this.select(items);
  }

  /** Bakes text into a plain shape: no longer editable as text, but its points are. */
  convertToShape(items = this.selection.filter(isText)) {
    for (const it of items) {
      delete it.data.text;
      it.applyMatrix = true;
    }
    if (items.length) this.commit();
  }

  // Node editing: drag points and handles, click a path edge to add a point.
  private selectedPaths(): paper.Path[] {
    return this.selection.flatMap((i) => (i instanceof paper.Path ? [i] : (i.getItems({ class: paper.Path }) as paper.Path[])));
  }

  private clearSegments() {
    for (const p of this.selectedPaths()) for (const s of p.segments) s.selected = false;
    this.selection.forEach((i) => (i.selected = true));
  }

  private nodeDown(e: paper.ToolEvent) {
    // `curves` hits path edges even when the shape has no stroke.
    const hit = this.content.hitTest(e.point, { segments: true, handles: true, curves: true, fill: true, tolerance: 6 / paper.view.zoom });
    if (!hit) { this.select([]); return; }
    let owner: paper.Item = hit.item;
    while (owner.parent && owner.parent !== this.content) owner = owner.parent;
    if (!this.selection.includes(owner)) this.select(mods(e).shift ? [...this.selection, owner] : [owner]);
    if (isText(owner)) {
      this.convertToShape([owner]);
      this.select(this.selection);
      this.onNotice('Text turned into a shape so you can edit its points.');
      return;
    }
    if (hit.type === 'segment') {
      if (!mods(e).shift && !hit.segment.selected) this.clearSegments();
      hit.segment.selected = mods(e).shift ? !hit.segment.selected : true;
      this.drag = { kind: 'segments', moved: false };
    } else if (hit.type === 'handle-in' || hit.type === 'handle-out') {
      this.drag = { kind: 'handle', segment: hit.segment, which: hit.type === 'handle-in' ? 'in' : 'out' };
    } else if ((hit.type === 'curve' || hit.type === 'stroke') && hit.location) {
      const seg = (hit.location.path as paper.Path).divideAt(hit.location) as unknown as paper.Segment | null;
      this.clearSegments();
      if (seg) seg.selected = true;
      this.drag = { kind: 'segments', moved: true };
    } else {
      this.clearSegments();
      this.drag = { kind: 'move', moved: false };
    }
  }

  private deleteSegments() {
    for (const p of this.selectedPaths()) {
      for (let i = p.segments.length - 1; i >= 0; i--) if (p.segments[i].selected) p.removeSegment(i);
      if (p.segments.length < 2) p.remove();
    }
    for (const it of this.selection) if (it.parent && it.isEmpty()) it.remove();
    this.select(this.selection.filter((i) => i.parent));
    this.commit();
  }

  private doubleClickAt(pt: paper.Point) {
    if (this.tool === 'pen') { this.finishPen(); return; }
    if (this.tool === 'select') {
      const item = this.topItemAt(pt);
      if (isText(item)) {
        this.onEditText({ item, at: pt });
      } else if (item && !(item instanceof paper.PointText)) {
        this.select([item]);
        this.setTool('node');
      }
      return;
    }
    if (this.tool === 'node') {
      const hit = this.content.hitTest(pt, { segments: true, tolerance: 6 / paper.view.zoom });
      if (hit?.type === 'segment') {
        const s = hit.segment;
        if (s.handleIn.isZero() && s.handleOut.isZero()) s.smooth({ type: 'catmull-rom' });
        else s.clearHandles();
        this.commit();
      }
    }
  }

  // ---------------------------------------------------------------- snapping

  /** Artboard edges and centre, plus the edges and centres of other visible shapes. */
  private snapLines(exclude = new Set<paper.Item>()) {
    const x = [0, ART / 2, ART];
    const y = [0, ART / 2, ART];
    for (const c of this.content.children) {
      if (exclude.has(c) || !c.visible) continue;
      const b = c.bounds;
      x.push(b.left, b.center.x, b.right);
      y.push(b.top, b.center.y, b.bottom);
    }
    return { x, y };
  }

  private snapAxis(values: number[], lines: number[]): { delta: number; line: number } | null {
    const tol = 6 / paper.view.zoom;
    let best: { delta: number; line: number } | null = null;
    for (const v of values)
      for (const l of lines) {
        const delta = l - v;
        if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: l };
      }
    return best;
  }

  private snapPoint(pt: paper.Point, skip = false, exclude?: Set<paper.Item>): paper.Point {
    this.snapGuides = { x: [], y: [] };
    if (!this.snapOn || skip) return pt;
    const lines = this.snapLines(exclude);
    const sx = this.snapAxis([pt.x], lines.x);
    const sy = this.snapAxis([pt.y], lines.y);
    if (sx) this.snapGuides.x.push(sx.line);
    if (sy) this.snapGuides.y.push(sy.line);
    return new paper.Point(pt.x + (sx?.delta ?? 0), pt.y + (sy?.delta ?? 0));
  }

  /** Same event with its point snapped; modifiers stay readable. */
  private snapEvent(e: paper.ToolEvent, exclude?: Set<paper.Item>): paper.ToolEvent {
    const exc = new Set(exclude);
    if (this.drag?.kind === 'create' && this.drag.item) exc.add(this.drag.item);
    const point = this.snapPoint(e.point, mods(e).noSnap, exc);
    // A plain object: ToolEvent's own properties are getters and cannot be overwritten.
    return { point, delta: e.delta, event: (e as unknown as { event: MouseEvent }).event } as unknown as paper.ToolEvent;
  }

  // ---------------------------------------------------------------- layers

  /** Top-level items, top of the stack first. */
  layers(): paper.Item[] {
    return this.content.children.slice().reverse();
  }

  setItemVisible(item: paper.Item, visible: boolean) {
    item.visible = visible;
    if (!visible) this.select(this.selection.filter((i) => i !== item));
    this.commit();
  }

  setItemLocked(item: paper.Item, locked: boolean) {
    item.locked = locked;
    if (locked) this.select(this.selection.filter((i) => i !== item));
    this.commit();
  }

  renameItem(item: paper.Item, name: string) {
    // A label in data, not item.name: Paper rejects names that are numbers or object keys.
    const label = name.trim().slice(0, 60);
    if (label) item.data.label = label;
    else delete item.data.label;
    this.commit();
  }

  /** Moves an item so it ends at stacking index `index` (0 = bottom), counted without the item itself. */
  moveItem(item: paper.Item, index: number) {
    const others = this.content.children.filter((c) => c !== item);
    const target = Math.max(0, Math.min(others.length, index));
    if (others[target - 1] === item.previousSibling && others[target] === item.nextSibling) return;
    item.remove();
    this.content.insertChild(target, item);
    this.commit();
  }

  // ---------------------------------------------------------------- reference image

  /** Shows a reference image. A saved matrix restores its position and size; otherwise it fits the artboard. */
  setReference(src: string | null, matrix: number[] | null = null) {
    if (this.refEditing) this.editReference(false);
    this.reference.src = src;
    this.reference.matrix = matrix;
    this.refLayer.removeChildren();
    if (src) {
      const raster = new paper.Raster({ source: src, parent: this.refLayer });
      raster.onLoad = () => {
        if (matrix?.length === 6) raster.matrix = new paper.Matrix(matrix);
        else this.fitReference('contain');
        this.applyReference();
      };
    }
    this.applyReference();
  }

  setReferenceStyle(opacity: number, visible: boolean) {
    this.reference.opacity = opacity;
    this.reference.visible = visible;
    this.applyReference();
  }

  /** 'contain' shows the whole image inside the artboard; 'cover' fills the artboard edge to edge. */
  fitReference(mode: 'contain' | 'cover') {
    const r = this.refRaster;
    if (!r || !r.width || !r.height) return;
    r.matrix = new paper.Matrix();
    const s = mode === 'contain' ? Math.min(ART / r.width, ART / r.height) : Math.max(ART / r.width, ART / r.height);
    r.scale(s);
    r.position = new paper.Point(ART / 2, ART / 2);
    this.saveReference();
    this.drawUI();
  }

  /** Turns move-and-resize mode for the reference image on or off. */
  editReference(on: boolean) {
    if (on && !this.refRaster) return;
    if (on === this.refEditing) return;
    if (on) {
      this.finishPen();
      if (this.tool !== 'select') this.setTool('select');
      this.select([]);
      this.reference.visible = true;
    }
    this.refEditing = on;
    this.applyReference();
    this.drawUI();
    this.onSelect();
  }

  private saveReference() {
    this.reference.matrix = this.refRaster ? this.refRaster.matrix.values : null;
    this.onReferenceChange();
  }

  private applyReference() {
    this.refLayer.opacity = this.reference.opacity;
    this.refLayer.visible = this.reference.visible && !!this.reference.src;
    this.onReference();
  }

  /** The reference image moved or resized; the UI saves it. */
  onReferenceChange = () => {};
  onReference = () => {};

  /** Two fingers pan and pinch-zoom the view. Paper never sees those touches. */
  private attachTouchGestures(canvas: HTMLCanvasElement) {
    let gesture: { dist: number; mid: paper.Point } | null = null;
    const read = (t: TouchList) => {
      const r = canvas.getBoundingClientRect();
      const a = new paper.Point(t[0].clientX - r.left, t[0].clientY - r.top);
      const b = new paper.Point(t[1].clientX - r.left, t[1].clientY - r.top);
      return { dist: Math.max(1, a.getDistance(b)), mid: a.add(b).divide(2) };
    };
    const opts = { capture: true, passive: false } as const;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancelDrag();
      gesture = read(e.touches);
    }, opts);
    canvas.addEventListener('touchmove', (e) => {
      if (!gesture || e.touches.length < 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const now = read(e.touches);
      const v = paper.view;
      // Keep the point under the fingers' midpoint fixed while zooming, then follow the fingers.
      const anchor = v.viewToProject(gesture.mid);
      v.zoom = Math.min(32, Math.max(0.05, v.zoom * (now.dist / gesture.dist)));
      v.center = v.center.add(anchor.subtract(v.viewToProject(now.mid)));
      gesture = now;
      this.drawUI();
      this.onView();
    }, opts);
    const end = (e: TouchEvent) => {
      if (!gesture) return;
      e.stopImmediatePropagation();
      if (e.touches.length < 2) gesture = null;
    };
    canvas.addEventListener('touchend', end, opts);
    canvas.addEventListener('touchcancel', end, opts);
  }

  /** Abandons the gesture in progress, removing a half-drawn shape. */
  private cancelDrag() {
    const d = this.drag;
    if (d?.kind === 'create') d.item?.remove();
    this.drag = null;
    this.snapGuides = { x: [], y: [] };
    this.drawUI();
  }

  // ---------------------------------------------------------------- view

  fit() {
    const v = paper.view;
    v.zoom = (Math.min(v.viewSize.width, v.viewSize.height) * 0.84) / ART;
    v.center = new paper.Point(ART / 2, ART / 2);
    this.drawUI();
    this.onView();
  }

  zoomBy(factor: number, at?: paper.Point) {
    const v = paper.view;
    const anchor = at ?? v.center;
    const before = anchor;
    const viewPt = v.projectToView(anchor);
    v.zoom = Math.min(32, Math.max(0.05, v.zoom * factor));
    const after = v.viewToProject(viewPt);
    v.center = v.center.add(before.subtract(after));
    this.drawUI();
    this.onView();
  }

  resize(w: number, h: number) {
    paper.view.viewSize = new paper.Size(w, h);
    this.drawUI();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-e.deltaY * 0.01), paper.view.viewToProject(new paper.Point(e.offsetX, e.offsetY)));
    } else {
      const z = paper.view.zoom;
      paper.view.center = paper.view.center.add(new paper.Point(e.deltaX / z, e.deltaY / z));
      this.drawUI();
      this.onView();
    }
  }

  // ---------------------------------------------------------------- commands

  boolean(op: BooleanOp): boolean {
    const items = this.sorted().filter((i): i is paper.PathItem => i instanceof paper.Path || i instanceof paper.CompoundPath);
    if (items.length < 2) return false;
    const base = items[0];
    let result: paper.PathItem = base;
    for (const it of items.slice(1)) {
      const next = result[op](it, { insert: false });
      if (result !== base) result.remove();
      result = next;
    }
    base.parent.insertChild(base.index, result);
    // Booleans copy applyMatrix from the bottom shape; text keeps its own matrix, shapes must not.
    result.applyMatrix = true;
    result.data = { ...base.data };
    delete result.data.text;
    delete result.data.rotation;
    const baseFill = readFill(base);
    if (baseFill.type === 'linear') applyFill(result, baseFill);
    items.forEach((i) => i.remove());
    this.select([result]);
    this.commit();
    return true;
  }

  group() {
    const s = this.sorted();
    if (s.length < 2) return;
    const g = new paper.Group();
    g.insertAbove(s[s.length - 1]);
    g.addChildren(s);
    this.select([g]);
    this.commit();
  }

  ungroup() {
    const out: paper.Item[] = [];
    for (const it of this.sorted()) {
      if (it instanceof paper.Group && !(it instanceof paper.Layer)) {
        const kids = it.removeChildren();
        for (const k of kids) {
          if (k.clipMask) k.remove();
          else k.opacity *= it.opacity;
        }
        it.parent.insertChildren(it.index, kids);
        it.remove();
        out.push(...kids.filter((k) => !k.clipMask));
      } else out.push(it);
    }
    this.select(out);
    this.commit();
  }

  duplicate() {
    const clones = this.sorted().map((i) => {
      const c = i.clone();
      c.translate(new paper.Point(24, 24));
      return c;
    });
    this.select(clones);
    this.commit();
  }

  copy() {
    this.clipboard = this.sorted().map((i) => i.clone({ insert: false }));
  }

  cut() {
    this.copy();
    this.remove();
  }

  paste() {
    if (!this.clipboard.length) return;
    const items = this.clipboard.map((c) => this.content.addChild(c.clone({ insert: false })));
    items.forEach((i) => i.translate(new paper.Point(24, 24)));
    this.clipboard = items.map((i) => i.clone({ insert: false }));
    this.select(items);
    this.commit();
  }

  remove() {
    if (!this.selection.length) return;
    this.selection.forEach((i) => i.remove());
    this.select([]);
    this.commit();
  }

  arrange(where: 'front' | 'forward' | 'backward' | 'back') {
    const s = this.sorted();
    if (where === 'front') s.forEach((i) => i.bringToFront());
    if (where === 'back') s.reverse().forEach((i) => i.sendToBack());
    if (where === 'forward')
      s.reverse().forEach((i) => {
        const n = i.nextSibling;
        if (n && !this.selection.includes(n)) i.insertAbove(n);
      });
    if (where === 'backward')
      s.forEach((i) => {
        const p = i.previousSibling;
        if (p && !this.selection.includes(p)) i.insertBelow(p);
      });
    this.commit();
  }

  /** One item aligns to the artboard; several align to their shared bounds. */
  align(where: Align) {
    const target = this.selection.length === 1 ? new paper.Rectangle(0, 0, ART, ART) : this.selBounds();
    if (!target) return;
    for (const it of this.selection) {
      const b = it.bounds;
      const dx = where === 'left' ? target.left - b.left : where === 'right' ? target.right - b.right : where === 'hcenter' ? target.center.x - b.center.x : 0;
      const dy = where === 'top' ? target.top - b.top : where === 'bottom' ? target.bottom - b.bottom : where === 'vcenter' ? target.center.y - b.center.y : 0;
      it.translate(new paper.Point(dx, dy));
    }
    this.commit();
  }

  rotate(deg: number) {
    const b = this.selBounds();
    if (!b || !deg) return;
    this.selection.forEach((i) => {
      i.rotate(deg, b.center);
      i.data.rotation = (((i.data.rotation ?? 0) + deg) % 360 + 540) % 360 - 180;
    });
    this.commit();
  }

  /** Rotation of the first selected item, as tracked by the rotate commands. */
  get rotation(): number {
    return Math.round((this.selection[0]?.data.rotation ?? 0) * 10) / 10;
  }

  flip(axis: 'h' | 'v') {
    const b = this.selBounds();
    if (!b) return;
    this.selection.forEach((i) => i.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1, b.center));
    this.commit();
  }

  nudge(dx: number, dy: number) {
    if (!this.targets.length) return;
    this.targets.forEach((i) => i.translate(new paper.Point(dx, dy)));
    if (this.refEditing) {
      this.saveReference();
      this.drawUI();
    } else this.commit();
  }

  setBounds(next: { x: number; y: number; w: number; h: number }) {
    const b = this.selBounds();
    if (!b) return;
    const sx = b.width ? Math.max(1, next.w) / b.width : 1;
    const sy = b.height ? Math.max(1, next.h) / b.height : 1;
    this.targets.forEach((i) => {
      if (sx !== 1 || sy !== 1) i.scale(sx, sy, b.topLeft);
      i.translate(new paper.Point(next.x - b.x, next.y - b.y));
    });
    if (this.refEditing) {
      this.saveReference();
      this.drawUI();
      this.onLive();
    } else this.commit();
  }

  setFill(f: Fill, final: boolean) {
    if (!this.selection.length) { this.newFill = { ...f }; return; }
    this.selection.forEach((i) => applyFill(i, f));
    final ? this.commit() : this.onLive();
  }

  setStroke(s: Stroke, final: boolean) {
    if (!this.selection.length) { this.newStroke = { ...s }; return; }
    for (const i of this.selection) {
      i.strokeColor = s.color ? new paper.Color(s.color) : null;
      i.strokeWidth = s.width;
      i.strokeJoin = 'round';
    }
    final ? this.commit() : this.onLive();
  }

  setOpacity(o: number, final: boolean) {
    this.selection.forEach((i) => (i.opacity = o));
    final ? this.commit() : this.onLive();
  }

  /** Fill, stroke and opacity of the first selected item, or the new-shape style. */
  currentStyle(): { fill: Fill; stroke: Stroke; opacity: number } {
    const it = this.selection[0];
    if (!it) return { fill: this.newFill, stroke: this.newStroke, opacity: 1 };
    const stroke = it.strokeColor && it.strokeWidth > 0 ? { color: hex(it.strokeColor), width: it.strokeWidth } : { color: null, width: it.strokeWidth || 24 };
    return { fill: readFill(it), stroke, opacity: it.opacity };
  }

  /**
   * Parses an SVG into a detached item: cleaned, with Paper's viewBox clip removed and
   * single-shape groups unwrapped. Throws if there is nothing drawable in it.
   */
  private parseSvg(svg: string): paper.Item {
    let item = paper.project.importSVG(cleanSvgForImport(svg), { expandShapes: true, insert: false }) as paper.Item | null;
    if (!item) throw new Error('Could not read that SVG.');
    // data-* attributes become item.data, which the editor uses for its own state (text, fills).
    for (const it of [item, ...item.getItems({})]) it.data = {};
    // Paper wraps the viewBox in a clip rectangle; drop it so ungrouping behaves.
    if (item instanceof paper.Group && item.firstChild?.clipMask) {
      item.firstChild.remove();
      item.clipped = false;
    }
    // Unwrap groups that hold a single shape, so Union and point editing work right away.
    while (item instanceof paper.Group && !item.clipped && item.children.length === 1) {
      const group: paper.Group = item;
      const only = group.firstChild;
      only.transform(group.matrix);
      only.opacity *= group.opacity;
      if (group.blendMode !== 'normal') only.blendMode = group.blendMode;
      if (group.name && !only.name) only.name = group.name;
      only.remove();
      item = only;
    }
    const b = item.bounds;
    if (!b.width && !b.height) throw new Error('That SVG has nothing to import.');
    return item;
  }

  /**
   * Adds an SVG to the artboard. `fit` is the share of the artboard its longer side fills
   * (default 0.6); `fill` repaints every shape, as for library icons.
   */
  importSVG(svg: string, opts: { fit?: number; fill?: Fill; name?: string; silent?: boolean } = {}): paper.Item {
    const item = this.parseSvg(svg);
    const b = item.bounds;
    this.content.addChild(item);
    // A full 1024 artboard (like one exported here) keeps its exact layout; anything else is fitted and centred.
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const isArtboard = vb ? vb[2] === ART && vb[3] === ART : root.getAttribute('width') === String(ART) && root.getAttribute('height') === String(ART);
    if (!isArtboard || opts.fit) {
      item.scale((ART * (opts.fit ?? 0.6)) / Math.max(b.width, b.height));
      item.position = new paper.Point(ART / 2, ART / 2);
    }
    if (opts.fill) {
      // Repaint each shape; duotone icons keep their faded second tone through opacity.
      const shapes = item instanceof paper.Group ? item.getItems({ class: paper.PathItem }) : [item];
      for (const sh of shapes) applyFill(sh, opts.fill);
      if (opts.fill.type === 'linear' && item instanceof paper.Group) applyFill(item, opts.fill);
    }
    if (opts.name) item.data.label = opts.name;
    if (opts.silent) return item;
    this.setTool('select');
    this.select([item]);
    this.commit();
    return item;
  }

  /**
   * Puts an SVG designed as a whole icon onto the artboard, for AI results. 'replace' swaps the
   * whole icon as one undo step, turning a full-size first rectangle into the artboard background;
   * 'add' puts the artwork on top. The drawing is parsed before anything is cleared, so a reply
   * that can't be read leaves the document untouched.
   */
  placeIconSvg(svg: string, mode: 'replace' | 'add'): paper.Item | null {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg') throw new Error('That is not an SVG drawing.');
    // Units like "512px" count; percentages and missing sizes fall back to the artboard size.
    const len = (v: string | null) => (v && !v.trim().endsWith('%') && parseFloat(v) > 0 ? parseFloat(v) : ART);
    const vbAttr = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const [vx, vy, vw, vh] =
      vbAttr && vbAttr.length === 4 && vbAttr.every(Number.isFinite) && vbAttr[2] > 0 && vbAttr[3] > 0
        ? vbAttr
        : [0, 0, len(root.getAttribute('width')), len(root.getAttribute('height'))];
    const drawable = () => [...root.children].filter((c) => !['defs', 'title', 'desc', 'metadata'].includes(c.localName));

    let bg: Fill | null = null;
    const first = drawable()[0];
    if (mode === 'replace' && first?.localName === 'rect' && !first.getAttribute('transform')) {
      const n = (a: string) => parseFloat(first.getAttribute(a) ?? '0') || 0;
      const covers = n('x') <= vx && n('y') <= vy && n('x') + n('width') >= vx + vw && n('y') + n('height') >= vy + vh;
      if (covers) {
        bg = fillFromSvg(first, doc);
        if (bg) first.remove();
      }
    }

    // Fit the drawing's view into the 1024 artboard, centred if it isn't square.
    const s = ART / Math.max(vw, vh);
    const tx = (ART - vw * s) / 2;
    const ty = (ART - vh * s) / 2;
    const wrap = doc.createElementNS(SVGNS, 'g');
    wrap.setAttribute('transform', `translate(${tx} ${ty}) scale(${s}) translate(${-vx} ${-vy})`);
    for (const c of drawable()) wrap.appendChild(c);
    root.appendChild(wrap);
    root.setAttribute('viewBox', `0 0 ${ART} ${ART}`);
    root.setAttribute('width', String(ART));
    root.setAttribute('height', String(ART));
    const out = new XMLSerializer().serializeToString(root);

    // Parse first: if this throws, nothing on the artboard has changed.
    let item: paper.Item | null = wrap.children.length ? this.parseSvg(out) : null;
    if (!item && !bg) throw new Error('The drawing had nothing that could be placed.');

    this.finishPen();
    if (mode === 'replace') {
      this.hideForEditing(null);
      this.docVersion++;
      this.content.removeChildren();
      if (bg) this.background = { enabled: true, fill: bg };
      this.applyBackground();
    }
    this.content.activate();
    let placed: paper.Item[] = [];
    if (item) {
      this.content.addChild(item);
      placed = [item];
      // Unpack the drawing into separate layers so each shape is easy to pick and restyle.
      if (item instanceof paper.Group && !item.clipped) {
        const group: paper.Group = item;
        const kids = group.removeChildren();
        for (const k of kids) k.opacity *= group.opacity;
        this.content.insertChildren(group.index, kids);
        group.remove();
        placed = kids;
        item = kids[kids.length - 1] ?? null;
      }
    }
    this.setTool('select');
    this.select(placed);
    this.commit();
    return item;
  }

  /**
   * Standalone SVG of the artboard: whole icon, background only, or foreground only.
   * 'background-bleed' is the background on a 1536 canvas with the artboard in the middle
   * 1024, matching the 108 dp adaptive layer whose visible 72 dp is the artboard.
   */
  toSVG(part: 'full' | 'background' | 'background-bleed' | 'foreground' = 'full'): string {
    // Each export numbers its gradients from color-1, so prefix ids to keep the layers apart.
    // Paper wraps exports that carry <defs> in a nested <svg>, whose viewport clips anything at
    // negative coordinates (the bleed). Unwrap it so the parts sit directly in our root.
    const exported = (layer: paper.Layer, prefix: string) =>
      (layer.exportSVG({ asString: true }) as unknown as string)
        .replace(/^<svg[^>]*>([\s\S]*)<\/svg>$/, '$1')
        .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
        .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
    if (part === 'background-bleed') {
      const pad = ART / 4;
      // Same paint, larger rectangle: the gradient keeps its artboard geometry and pads outwards.
      const bleed = new paper.Path.Rectangle({ rectangle: new paper.Rectangle(-pad, -pad, ART + 2 * pad, ART + 2 * pad), insert: false });
      bleed.fillColor = this.bgRect.fillColor ? this.bgRect.fillColor.clone() : null;
      const holder = new paper.Layer({ insert: false, children: [bleed] });
      const size = ART + 2 * pad;
      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="${-pad} ${-pad} ${size} ${size}">${exported(holder, 'bg')}</svg>`;
    }
    const parts: string[] = [];
    if (part !== 'foreground' && this.background.enabled) parts.push(exported(this.bgLayer, 'bg'));
    if (part !== 'background') parts.push(exported(this.content, 'fg'));
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ART}" height="${ART}" viewBox="0 0 ${ART} ${ART}">${parts.join('')}</svg>`;
  }

  // ---------------------------------------------------------------- keyboard

  private keyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') {
      if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); }
      e.preventDefault();
      return;
    }
    if (mod) {
      const run: Record<string, () => void> = {
        z: () => (e.shiftKey ? this.redo() : this.undo()),
        y: () => this.redo(),
        d: () => this.duplicate(),
        g: () => (e.shiftKey ? this.ungroup() : this.group()),
        c: () => this.copy(),
        x: () => this.cut(),
        v: () => this.paste(),
        a: () => this.selectAll(),
        '=': () => this.zoomBy(1.25),
        '+': () => this.zoomBy(1.25),
        '-': () => this.zoomBy(0.8),
        '0': () => this.fit(),
      };
      if (run[k]) { e.preventDefault(); run[k](); }
      return;
    }
    if (this.refEditing && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault();
      this.editReference(false);
      return;
    }
    if (this.refEditing && (e.key === 'Delete' || e.key === 'Backspace')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (this.tool === 'node' && this.selectedPaths().some((p) => p.segments.some((s) => s.selected))) this.deleteSegments();
      else this.remove();
      return;
    }
    if (e.key === 'Enter' && this.selection.length === 1 && isText(this.selection[0]) && this.tool === 'select') {
      e.preventDefault();
      this.onEditText({ item: this.selection[0], at: this.selection[0].position });
      return;
    }
    if (e.key === 'Enter') { this.finishPen(); if (this.tool === 'node') this.setTool('select'); return; }
    if (e.key === 'Escape') {
      if (this.penPath) this.finishPen();
      else if (this.tool !== 'select') this.setTool('select');
      else this.select([]);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (arrows[k]) { e.preventDefault(); this.nudge(...arrows[k]); return; }
    if (e.shiftKey && e.code === 'Digit1') { this.fit(); return; }
    const tools: Record<string, ToolName> = { v: 'select', a: 'node', r: 'rect', o: 'ellipse', y: 'polygon', s: 'star', l: 'line', p: 'pen', t: 'text' };
    if (tools[k] && !e.altKey) this.setTool(tools[k]);
  }
}
