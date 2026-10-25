/** Rasterizes the editor's SVG output into icon bitmaps. */

export type Mask = 'none' | 'circle' | 'squircle' | 'rounded';

/** The three images every icon is built from: whole artboard, background only, foreground only. */
export interface IconImages {
  full: HTMLImageElement;
  bg: HTMLImageElement | null;
  fg: HTMLImageElement;
}

export async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

export async function loadImages(svgs: { full: string; bg: string | null; fg: string }): Promise<IconImages> {
  const [full, bg, fg] = await Promise.all([loadSvg(svgs.full), svgs.bg ? loadSvg(svgs.bg) : null, loadSvg(svgs.fg)]);
  return { full, bg, fg };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** Apple-style continuous corner, approximated with a superellipse. */
function squirclePath(ctx: CanvasRenderingContext2D, size: number) {
  const r = size / 2;
  const n = 5;
  ctx.beginPath();
  for (let i = 0; i <= 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const x = r + r * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n);
    const y = r + r * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, size: number, mask: Mask) {
  if (mask === 'none') return;
  if (mask === 'circle') {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else if (mask === 'squircle') {
    squirclePath(ctx, size);
  } else {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.18);
  }
  ctx.clip();
}

/** The whole artboard at `size`. `opaque` paints a color underneath for platforms that reject alpha. */
export function drawFull(imgs: IconImages, size: number, mask: Mask = 'none', opaque?: string) {
  const { c, ctx } = canvas(size);
  clip(ctx, size, mask);
  if (opaque) {
    ctx.fillStyle = opaque;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(imgs.full, 0, 0, size, size);
  return c;
}

/**
 * Adaptive icon layers use a 108dp canvas whose visible viewport is the centre 72dp.
 * The artboard maps to that viewport, so the foreground sits in the middle two thirds.
 */
const VIEWPORT = 72 / 108;

export function drawAdaptiveFg(imgs: IconImages, size: number) {
  const { c, ctx } = canvas(size);
  const s = size * VIEWPORT;
  ctx.drawImage(imgs.fg, (size - s) / 2, (size - s) / 2, s, s);
  return c;
}

export function drawAdaptiveBg(imgs: IconImages, size: number) {
  const { c, ctx } = canvas(size);
  if (imgs.bg) ctx.drawImage(imgs.bg, 0, 0, size, size);
  else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }
  return c;
}

/** Background full bleed plus foreground in the safe area: Android adaptive and web maskable. */
export function drawAdaptive(imgs: IconImages, size: number, mask: Mask = 'none') {
  const { c, ctx } = canvas(size);
  clip(ctx, size, mask);
  ctx.drawImage(drawAdaptiveBg(imgs, size), 0, 0);
  ctx.drawImage(drawAdaptiveFg(imgs, size), 0, 0);
  return c;
}

export async function png(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Packs PNG images into a .ico file (PNG-compressed entries, supported since Windows Vista). */
export function ico(entries: { size: number; data: Uint8Array }[]): Uint8Array {
  const headerSize = 6 + 16 * entries.length;
  const total = headerSize + entries.reduce((n, e) => n + e.data.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let offset = headerSize;
  entries.forEach((e, i) => {
    const p = 6 + i * 16;
    v.setUint8(p, e.size >= 256 ? 0 : e.size);
    v.setUint8(p + 1, e.size >= 256 ? 0 : e.size);
    v.setUint8(p + 2, 0);
    v.setUint8(p + 3, 0);
    v.setUint16(p + 4, 1, true);
    v.setUint16(p + 6, 32, true);
    v.setUint32(p + 8, e.data.length, true);
    v.setUint32(p + 12, offset, true);
    out.set(e.data, offset);
    offset += e.data.length;
  });
  return out;
}
