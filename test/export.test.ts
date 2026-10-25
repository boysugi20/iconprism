import { describe, expect, it } from 'vitest';
import { parseSizes, slug } from '../src/export';

describe('slug', () => {
  it('makes a safe folder name', () => {
    expect(slug('My Cool App!')).toBe('my-cool-app');
    expect(slug('  --Café 2.0--  ')).toBe('caf-2-0');
  });
  it('falls back when nothing usable is left', () => {
    expect(slug('')).toBe('app');
    expect(slug('***')).toBe('app');
  });
});

describe('parseSizes', () => {
  it('accepts commas, spaces and px suffixes, sorted and unique', () => {
    expect(parseSizes('256, 64 128px;64')).toEqual([64, 128, 256]);
  });
  it('drops sizes that are not whole numbers between 16 and 4096', () => {
    expect(parseSizes('8, 15, 16, 4096, 5000, 12.5, abc, -32')).toEqual([16, 4096]);
  });
  it('returns nothing for empty input', () => {
    expect(parseSizes('')).toEqual([]);
  });
});
