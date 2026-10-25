/** Rasterizes the editor's SVG output into icon bitmaps. */

export type Mask = 'none' | 'circle' | 'squircle' | 'rounded';

/** The three images every icon is built from: whole artboard, background only, foreground only. */
export interface IconImages {
  full: HTMLImageElement;
  bg: HTMLImageElement | null;
  /** Background on the 108 dp canvas (artboard = centre 72 dp), for adaptive and maskable icons. */
  bgBleed: HTMLImageElement | null;
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

export interface IconSvgs {
  full: string;
  bg: string | null;
  bgBleed: string | null;
  fg: string;
}

export async function loadImages(svgs: IconSvgs): Promise<IconImages> {
  const [full, bg, bgBleed, fg] = await Promise.all([
    loadSvg(svgs.full),
    svgs.bg ? loadSvg(svgs.bg) : null,
    svgs.bgBleed ? loadSvg(svgs.bgBleed) : null,
    loadSvg(svgs.fg),
  ]);
  return { full, bg, bgBleed, fg };
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

/** The artwork without its background: iOS dark icons, and greyscale for iOS tinted icons. */
export function drawForeground(imgs: IconImages, size: number, opts: { grayscale?: boolean; under?: string } = {}) {
  const { c, ctx } = canvas(size);
  ctx.drawImage(imgs.fg, 0, 0, size, size);
  if (opts.grayscale) {
    const data = ctx.getImageData(0, 0, size, size);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = l;
    }
    ctx.putImageData(data, 0, 0);
  }
  if (opts.under) {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = opts.under;
    ctx.fillRect(0, 0, size, size);
  }
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
  const bg = imgs.bgBleed ?? imgs.bg;
  if (bg) ctx.drawImage(bg, 0, 0, size, size);
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const body = out.subarray(4, 8 + data.length);
  body.set([...type].map((ch) => ch.charCodeAt(0)));
  body.set(data, 4);
  v.setUint32(8 + data.length, crc32(body));
  return out;
}

/**
 * PNG without an alpha channel (colour type 2). App Store Connect rejects app icons
 * with an alpha channel even when every pixel is opaque, and canvas.toBlob always writes RGBA.
 */
export async function pngRGB(c: HTMLCanvasElement): Promise<Uint8Array> {
  return encodeRGB(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

/** Encodes RGBA pixels as an RGB PNG, dropping alpha. */
export async function encodeRGB(px: Uint8ClampedArray | Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0, o = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = px[i];
      raw[o++] = px[i + 1];
      raw[o++] = px[i + 2];
    }
  }
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, adaptive filtering, no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zipped), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
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
