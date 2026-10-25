import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeRGB, ico } from '../src/render';

const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o);

describe('encodeRGB', () => {
  it('writes a valid PNG with colour type 2 (no alpha channel)', async () => {
    // 2x1: opaque red, then half-transparent green (alpha must be dropped, not blended).
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = await encodeRGB(px, 2, 1);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(png.slice(12, 16))).toBe('IHDR');
    expect(u32(png, 16)).toBe(2);
    expect(u32(png, 20)).toBe(1);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);

    const idatLen = u32(png, 33);
    expect(new TextDecoder().decode(png.slice(37, 41))).toBe('IDAT');
    const raw = inflateSync(png.slice(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0]);
    expect(new TextDecoder().decode(png.slice(-8, -4))).toBe('IEND');
  });
});

describe('ico', () => {
  it('writes a directory that points at each embedded PNG', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6, 7]);
    const out = ico([{ size: 16, data: a }, { size: 256, data: b }]);
    const v = new DataView(out.buffer);
    expect(v.getUint16(0, true)).toBe(0);
    expect(v.getUint16(2, true)).toBe(1);
    expect(v.getUint16(4, true)).toBe(2);
    expect(out[6]).toBe(16);
    expect(out[22]).toBe(0); // 256 px is stored as 0
    expect(v.getUint16(6 + 6, true)).toBe(32);
    const offA = v.getUint32(6 + 12, true);
    const offB = v.getUint32(22 + 12, true);
    expect(offA).toBe(6 + 32);
    expect([...out.slice(offA, offA + 3)]).toEqual([1, 2, 3]);
    expect([...out.slice(offB, offB + 4)]).toEqual([4, 5, 6, 7]);
    expect(out.length).toBe(6 + 32 + 7);
  });
});
