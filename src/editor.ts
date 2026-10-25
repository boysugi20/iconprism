import paper from 'paper/dist/paper-core';

/** Artboard size in project units. Everything is designed at 1024 x 1024. */
export const ART = 1024;
export const ACCENT = '#e4ff4f';
const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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
  | { kind: 'move'; moved: boolean }
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
  return { shift: !!n?.shiftKey, alt: !!n?.altKey };
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
    const b = item.bounds;
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
  if (stored) return { ...stored };
  const c = item.fillColor;
  if (!c) return { type: 'none', color: '#ffffff', color2: '#000000', angle: 90 };
  if (c.gradient) {
    const stops = c.gradient.stops;
    const g = c as unknown as { origin?: paper.Point; destination?: paper.Point };
    const angle = g.origin && g.destination ? Math.round(g.destination.subtract(g.origin).angle) : 90;
    return { type: 'linear', color: hex(stops[0].color), color2: hex(stops[stops.length - 1].color), angle };
  }
  return solid(hex(c));
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

  private board: paper.Layer;
  private bgLayer: paper.Layer;
  private bgRect: paper.Path;
  private content: paper.Layer;
  private guideLayer: paper.Layer;
  private ui: paper.Layer;
  private drag: Drag | null = null;
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
    this.content = new paper.Layer();
    this.content.selectedColor = new paper.Color(ACCENT);
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
    canvas.addEventListener('dblclick', (e) => this.doubleClick(e));
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });

    if (!this.restore()) this.starter();
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

  private serialize() {
    return JSON.stringify({ v: 1, background: this.background, content: this.content.exportJSON({ asString: false }) });
  }

  private load(snap: string) {
    const d = JSON.parse(snap);
    this.background = d.background;
    this.content.removeChildren();
    this.content.importJSON(d.content);
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
    this.finishPen();
    if (this.hIndex <= 0) return;
    this.load(this.history[--this.hIndex]);
    this.persist(this.history[this.hIndex]);
    this.onChange();
  }

  redo() {
    if (this.hIndex >= this.history.length - 1) return;
    this.load(this.history[++this.hIndex]);
    this.persist(this.history[this.hIndex]);
    this.onChange();
  }

  get canUndo() { return this.hIndex > 0; }
  get canRedo() { return this.hIndex < this.history.length - 1; }

  private persist(snap: string) {
    try { localStorage.setItem(STORAGE_KEY, snap); } catch { /* storage full or blocked */ }
  }

  private restore(): boolean {
    try {
      const snap = localStorage.getItem(STORAGE_KEY);
      if (!snap) return false;
      this.load(snap);
      return true;
    } catch {
      return false;
    }
  }

  clearAll() {
    this.finishPen();
    this.content.removeChildren();
    this.select([]);
    this.commit();
  }

  // ---------------------------------------------------------------- selection

  select(items: paper.Item[]) {
    paper.project.deselectAll();
    this.selection = items.filter((i) => i.parent === this.content);
    if (this.tool === 'node') this.selection.forEach((i) => (i.selected = true));
    this.drawUI();
    this.onSelect();
  }

  selectAll() {
    this.select(this.content.children.slice());
  }

  /** Selection in stacking order, bottom first. */
  private sorted() {
    return this.selection.slice().sort((a, b) => a.index - b.index);
  }

  selBounds(): paper.Rectangle | null {
    if (!this.selection.length) return null;
    return this.selection.map((i) => i.bounds).reduce((a, b) => a.unite(b));
  }

  private topItemAt(pt: paper.Point): paper.Item | null {
    const hit = this.content.hitTest(pt, { fill: true, stroke: true, segments: true, tolerance: 4 / paper.view.zoom });
    if (!hit) return null;
    let it: paper.Item = hit.item;
    while (it.parent && it.parent !== this.content) it = it.parent;
    return it.parent === this.content ? it : null;
  }

  private handleAt(pt: paper.Point): Handle | null {
    const b = this.tool === 'select' ? this.selBounds() : null;
    if (!b) return null;
    const r = 7 / paper.view.zoom;
    return HANDLES.find((h) => handlePoint(b, h).getDistance(pt) <= r) ?? null;
  }

  /** Redraws selection box, handles, marquee and pen rubber band. */
  drawUI(extra?: { marquee?: paper.Rectangle; rubber?: [paper.Point, paper.Point] }) {
    const ui = this.ui;
    ui.removeChildren();
    const z = paper.view.zoom;
    const b = this.tool === 'select' ? this.selBounds() : null;
    if (b) {
      if (this.selection.length > 1)
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
    if (extra?.rubber)
      new paper.Path.Line({ from: extra.rubber[0], to: extra.rubber[1], parent: ui, strokeColor: ACCENT, strokeWidth: 1, strokeScaling: false, dashArray: [4, 3] });
  }

  // ---------------------------------------------------------------- tools

  setTool(t: ToolName) {
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

  private down(e: paper.ToolEvent) {
    const native = (e as unknown as { event: MouseEvent }).event;
    if (this.spaceDown || native.button === 1) {
      this.drag = { kind: 'pan', x: native.clientX, y: native.clientY };
      return;
    }
    switch (this.tool) {
      case 'select': return this.selectDown(e);
      case 'node': return this.nodeDown(e);
      case 'pen': return this.penDown(e);
      case 'text': return this.textDown(e);
      default: this.drag = { kind: 'create', from: e.point, item: null };
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
      case 'move':
        this.selection.forEach((i) => i.translate(e.delta));
        d.moved = true;
        this.drawUI();
        this.onLive();
        return;
      case 'scale':
        return this.scaleDrag(d, e);
      case 'marquee':
        d.to = e.point;
        this.drawUI({ marquee: new paper.Rectangle(d.from, d.to) });
        return;
      case 'create':
        return this.createDrag(d, e);
      case 'segments':
        for (const p of this.selectedPaths())
          for (const s of p.segments) if (s.selected) s.point = s.point.add(e.delta);
        d.moved = true;
        this.onLive();
        return;
      case 'handle': {
        const s = d.segment;
        const v = e.point.subtract(s.point);
        const other = d.which === 'out' ? s.handleIn : s.handleOut;
        const mirror = !mods(e).alt && !other.isZero() ? v.normalize(-other.length) : other;
        if (d.which === 'out') { s.handleOut = v; s.handleIn = mirror; } else { s.handleIn = v; s.handleOut = mirror; }
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
    if (!d) return;
    switch (d.kind) {
      case 'move':
        if (d.moved) this.commit();
        return;
      case 'scale':
      case 'handle':
        return this.commit();
      case 'segments':
        if (d.moved) this.commit();
        return;
      case 'marquee': {
        const r = new paper.Rectangle(d.from, d.to);
        const hits = r.width < 2 && r.height < 2 ? [] : this.content.children.filter((c) => r.intersects(c.bounds));
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
    const hp = handlePoint(d.start, d.handle);
    const horiz = d.handle.includes('e') || d.handle.includes('w');
    const vert = d.handle.includes('n') || d.handle.includes('s');
    let fx = horiz && hp.x !== d.anchor.x ? (e.point.x - d.anchor.x) / (hp.x - d.anchor.x) : 1;
    let fy = vert && hp.y !== d.anchor.y ? (e.point.y - d.anchor.y) / (hp.y - d.anchor.y) : 1;
    if (mods(e).shift) {
      const f = horiz && vert ? Math.max(Math.abs(fx), Math.abs(fy)) : Math.abs(horiz ? fx : fy);
      fx = Math.sign(fx || 1) * f;
      fy = Math.sign(fy || 1) * f;
      if (!horiz) fx = f;
      if (!vert) fy = f;
    }
    const clamp = (v: number) => (Math.abs(v) < 0.01 ? 0.01 * Math.sign(v || 1) : v);
    fx = clamp(fx);
    fy = clamp(fy);
    this.selection.forEach((i) => i.scale(fx / d.fx, fy / d.fy, d.anchor));
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
      p.add(e.point);
    } else {
      this.penPath = new paper.Path({ segments: [e.point], strokeColor: ACCENT, strokeWidth: 1.5, strokeScaling: false });
    }
    this.drag = { kind: 'pen' };
  }

  finishPen() {
    const p = this.penPath;
    this.penPath = null;
    if (!p) return;
    this.drawUI();
    if (p.segments.length < 2) { p.remove(); return; }
    p.strokeScaling = true;
    p.strokeColor = null;
    this.styleNew(p, !p.closed);
    this.select([p]);
    this.commit();
  }

  private textDown(e: paper.ToolEvent) {
    const s = window.prompt('Text', 'A');
    if (!s) return;
    const t = new paper.PointText({ point: e.point, content: s, fontFamily: TEXT_FONT, fontWeight: 'bold', fontSize: 320, justification: 'center' });
    t.position = e.point;
    applyFill(t, this.newFill.type === 'none' ? solid('#ffffff') : this.newFill);
    this.setTool('select');
    this.select([t]);
    this.commit();
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
    const hit = this.content.hitTest(e.point, { segments: true, handles: true, stroke: true, fill: true, tolerance: 6 / paper.view.zoom });
    if (!hit) { this.select([]); return; }
    let owner: paper.Item = hit.item;
    while (owner.parent && owner.parent !== this.content) owner = owner.parent;
    if (!this.selection.includes(owner)) this.select(mods(e).shift ? [...this.selection, owner] : [owner]);
    if (hit.type === 'segment') {
      if (!mods(e).shift && !hit.segment.selected) this.clearSegments();
      hit.segment.selected = mods(e).shift ? !hit.segment.selected : true;
      this.drag = { kind: 'segments', moved: false };
    } else if (hit.type === 'handle-in' || hit.type === 'handle-out') {
      this.drag = { kind: 'handle', segment: hit.segment, which: hit.type === 'handle-in' ? 'in' : 'out' };
    } else if (hit.type === 'stroke' && hit.location && hit.item instanceof paper.Path) {
      const seg = hit.item.divideAt(hit.location) as unknown as paper.Segment | null;
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
    this.select(this.selection.filter((i) => i.parent));
    this.commit();
  }

  private doubleClick(ev: MouseEvent) {
    const pt = paper.view.viewToProject(new paper.Point(ev.offsetX, ev.offsetY));
    if (this.tool === 'pen') { this.finishPen(); return; }
    if (this.tool === 'select') {
      const item = this.topItemAt(pt);
      if (item && !(item instanceof paper.PointText)) {
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
    result.data = { ...base.data };
    if (base.data.fill?.type === 'linear') applyFill(result, base.data.fill);
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
    if (!b) return;
    this.selection.forEach((i) => i.rotate(deg, b.center));
    this.commit();
  }

  flip(axis: 'h' | 'v') {
    const b = this.selBounds();
    if (!b) return;
    this.selection.forEach((i) => i.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1, b.center));
    this.commit();
  }

  nudge(dx: number, dy: number) {
    if (!this.selection.length) return;
    this.selection.forEach((i) => i.translate(new paper.Point(dx, dy)));
    this.commit();
  }

  setBounds(next: { x: number; y: number; w: number; h: number }) {
    const b = this.selBounds();
    if (!b) return;
    const sx = b.width ? Math.max(1, next.w) / b.width : 1;
    const sy = b.height ? Math.max(1, next.h) / b.height : 1;
    this.selection.forEach((i) => {
      if (sx !== 1 || sy !== 1) i.scale(sx, sy, b.topLeft);
      i.translate(new paper.Point(next.x - b.x, next.y - b.y));
    });
    this.commit();
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

  importSVG(svg: string) {
    const item = paper.project.importSVG(svg, { expandShapes: true, insert: false }) as paper.Item | null;
    if (!item) throw new Error('Could not read that SVG.');
    // Paper wraps the viewBox in a clip rectangle; drop it so ungrouping behaves.
    item.getItems({ clipMask: true }).forEach((c) => c.remove());
    if (item instanceof paper.Group) item.clipped = false;
    this.content.addChild(item);
    const b = item.bounds;
    if (b.width > ART || b.height > ART || b.width === 0) {
      const s = (ART * 0.8) / Math.max(b.width, b.height, 1);
      item.scale(s);
    }
    item.position = new paper.Point(ART / 2, ART / 2);
    this.setTool('select');
    this.select([item]);
    this.commit();
  }

  /** Standalone SVG of the artboard: whole icon, background only, or foreground only. */
  toSVG(part: 'full' | 'background' | 'foreground' = 'full'): string {
    // Each export numbers its gradients from color-1, so prefix ids to keep the layers apart.
    const exported = (layer: paper.Layer, prefix: string) =>
      (layer.exportSVG({ asString: true }) as unknown as string)
        .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
        .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
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
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (this.tool === 'node' && this.selectedPaths().some((p) => p.segments.some((s) => s.selected))) this.deleteSegments();
      else this.remove();
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
