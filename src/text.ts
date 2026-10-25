/**
 * Text is stored as vector outlines (a CompoundPath) plus the spec that made it,
 * so it exports exactly, works with Union/Subtract, and stays editable.
 */
import type * as opentype from 'opentype.js';
import type { Font } from 'opentype.js';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextSpec {
  content: string;
  font: string;
  weight: number;
  size: number;
  align: TextAlign;
  /** Letter spacing in thousandths of an em. */
  spacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
}

export interface FontInfo {
  id: string;
  name: string;
  weights: number[];
}

export const FONTS: FontInfo[] = [
  { id: 'inter', name: 'Inter', weights: [400, 600, 800] },
  { id: 'poppins', name: 'Poppins', weights: [400, 600, 800] },
  { id: 'montserrat', name: 'Montserrat', weights: [400, 700, 900] },
  { id: 'space-grotesk', name: 'Space Grotesk', weights: [400, 700] },
  { id: 'archivo-black', name: 'Archivo Black', weights: [400] },
  { id: 'anton', name: 'Anton', weights: [400] },
  { id: 'bebas-neue', name: 'Bebas Neue', weights: [400] },
  { id: 'righteous', name: 'Righteous', weights: [400] },
  { id: 'fredoka', name: 'Fredoka', weights: [400, 600] },
  { id: 'pacifico', name: 'Pacifico', weights: [400] },
  { id: 'playfair-display', name: 'Playfair Display', weights: [400, 700, 900] },
  { id: 'dm-serif-display', name: 'DM Serif Display', weights: [400] },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', weights: [400, 800] },
];

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
};

export const DEFAULT_TEXT: TextSpec = {
  content: '',
  font: 'inter',
  weight: 800,
  size: 320,
  align: 'center',
  spacing: 0,
  lineHeight: 1.1,
};

// Only the weights listed above ship with the site; each loads on first use.
const FILES = import.meta.glob(
  [
    '/node_modules/@fontsource/{inter,poppins}/files/*-latin-{400,600,800}-normal.woff',
    '/node_modules/@fontsource/{montserrat,playfair-display}/files/*-latin-{400,700,900}-normal.woff',
    '/node_modules/@fontsource/space-grotesk/files/*-latin-{400,700}-normal.woff',
    '/node_modules/@fontsource/fredoka/files/*-latin-{400,600}-normal.woff',
    '/node_modules/@fontsource/jetbrains-mono/files/*-latin-{400,800}-normal.woff',
    '/node_modules/@fontsource/{archivo-black,anton,bebas-neue,righteous,pacifico,dm-serif-display}/files/*-latin-400-normal.woff',
  ],
  { query: '?url', import: 'default' },
) as Record<string, () => Promise<string>>;

export interface LoadedFont {
  font: Font;
  /** CSS family registered for the on-canvas editor. */
  family: string;
}

const cache = new Map<string, Promise<LoadedFont>>();
const custom = new Map<string, FontInfo>();

export function fontInfo(id: string): FontInfo | undefined {
  return FONTS.find((f) => f.id === id) ?? custom.get(id);
}

export function allFonts(): FontInfo[] {
  return [...FONTS, ...custom.values()];
}

export function nearestWeight(id: string, weight: number): number {
  const ws = fontInfo(id)?.weights ?? [400];
  return ws.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
}

async function parse(buffer: ArrayBuffer): Promise<Font> {
  const { parse } = await import('opentype.js');
  return parse(buffer);
}

async function register(family: string, buffer: ArrayBuffer, weight: number) {
  const face = new FontFace(family, buffer, { weight: String(weight) });
  await face.load();
  document.fonts.add(face);
}

export function loadFont(id: string, weight: number): Promise<LoadedFont> {
  const w = nearestWeight(id, weight);
  const key = `${id}:${w}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const loader = FILES[`/node_modules/@fontsource/${id}/files/${id}-latin-${w}-normal.woff`];
      if (!loader) throw new Error(id.startsWith('custom:') ? 'Upload this font again to edit the text.' : `Font ${id} is not available.`);
      const buffer = await (await fetch(await loader())).arrayBuffer();
      const family = `ip-${id}-${w}`;
      const [font] = await Promise.all([parse(buffer), register(family, buffer.slice(0), w)]);
      return { font, family };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Adds a user's .ttf/.otf/.woff for this session. Returns the new font id. */
export async function addCustomFont(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const font = await parse(buffer);
  const name = font.names.fontFamily?.en || file.name.replace(/\.[^.]+$/, '');
  const weight = (font.tables.os2 as { usWeightClass?: number } | undefined)?.usWeightClass ?? 400;
  const id = `custom:${name}:${weight}`;
  const family = `ip-custom-${custom.size}`;
  await register(family, buffer.slice(0), weight);
  custom.set(id, { id, name: `${name} (uploaded)`, weights: [weight] });
  cache.set(`${id}:${weight}`, Promise.resolve({ font, family }));
  return id;
}

/**
 * Lays out the text as SVG path data. Local origin is the first baseline,
 * at the left, centre or right edge depending on alignment.
 *
 * Glyphs are placed one by one with pair kerning. opentype.js's own shaping
 * (getPath) throws on GSUB lookups it does not support, such as Inter's ccmp.
 */
export function textPathData(font: Font, spec: TextSpec): string {
  const scale = spec.size / font.unitsPerEm;
  const gap = (spec.spacing / 1000) * spec.size;
  const kern = (a: opentype.Glyph, b: opentype.Glyph) => {
    try {
      return font.getKerningValue(a, b) * scale;
    } catch {
      return 0;
    }
  };
  return spec.content
    .split('\n')
    .map((line, i) => {
      const placed: { glyph: opentype.Glyph; x: number }[] = [];
      let x = 0;
      let prev: opentype.Glyph | null = null;
      for (const ch of Array.from(line)) {
        const glyph = font.charToGlyph(ch);
        if (prev) x += kern(prev, glyph) + gap;
        placed.push({ glyph, x });
        x += (glyph.advanceWidth ?? 0) * scale;
        prev = glyph;
      }
      const offset = spec.align === 'center' ? -x / 2 : spec.align === 'right' ? -x : 0;
      const y = i * spec.size * spec.lineHeight;
      return placed.map((p) => p.glyph.getPath(p.x + offset, y, spec.size).toPathData(2)).join(' ');
    })
    .join(' ');
}
