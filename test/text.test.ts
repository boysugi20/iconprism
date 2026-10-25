import { readFileSync } from 'node:fs';
import { parse, type Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT, FONTS, nearestWeight, textPathData, type TextSpec } from '../src/text';

let inter: Font;
beforeAll(() => {
  const buf = readFileSync('node_modules/@fontsource/inter/files/inter-latin-800-normal.woff');
  inter = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

/** Coordinate pairs from absolute path data (M, L, Q, C, Z only, as opentype.js writes it). */
function points(d: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [, , args] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  }
  return out;
}

function xExtent(d: string) {
  const xs = points(d).map((p) => p[0]);
  return [Math.min(...xs), Math.max(...xs)];
}

const spec = (p: Partial<TextSpec>): TextSpec => ({ ...DEFAULT_TEXT, content: 'Hi', ...p });

describe('textPathData', () => {
  it('lays out Inter without throwing (its GSUB data breaks opentype.js shaping)', () => {
    expect(textPathData(inter, spec({ content: 'Affinity fi ffl' })).length).toBeGreaterThan(100);
  });

  it('centres on the origin, or starts or ends there for left and right', () => {
    const [cl, cr] = xExtent(textPathData(inter, spec({ align: 'center' })));
    expect(Math.abs(cl + cr)).toBeLessThan(40);
    expect(xExtent(textPathData(inter, spec({ align: 'left' })))[0]).toBeGreaterThanOrEqual(-1);
    expect(xExtent(textPathData(inter, spec({ align: 'right' })))[1]).toBeLessThanOrEqual(1);
  });

  it('letter spacing widens the text', () => {
    const w = (s: number) => {
      const [l, r] = xExtent(textPathData(inter, spec({ align: 'left', spacing: s })));
      return r - l;
    };
    expect(w(200)).toBeGreaterThan(w(0) + 0.15 * DEFAULT_TEXT.size);
  });

  it('puts each line lower by size x line height', () => {
    const d = textPathData(inter, spec({ content: 'A\nA', lineHeight: 1.5 }));
    const ys = points(d).map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DEFAULT_TEXT.size * 1.5 - 1);
  });

  it('returns nothing for empty text', () => {
    expect(textPathData(inter, spec({ content: '' })).trim()).toBe('');
  });
});

describe('nearestWeight', () => {
  it('snaps to a weight the font ships', () => {
    expect(nearestWeight('inter', 700)).toBe(600);
    expect(nearestWeight('inter', 900)).toBe(800);
    expect(nearestWeight('anton', 800)).toBe(400);
    expect(nearestWeight('unknown', 700)).toBe(400);
  });
  it('lists only bundled weights', () => {
    for (const f of FONTS) expect(f.weights.length).toBeGreaterThan(0);
  });
});
