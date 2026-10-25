import { describe, expect, it } from 'vitest';
import { searchIcons, withColor, type IconMeta } from '../src/iconlib';

const icon = (name: string, tags: string[] = [], categories: string[] = []): IconMeta => ({ name, label: name, tags, categories });
const all = [
  icon('heart', ['love', 'like'], ['health & wellness']),
  icon('heartbeat', ['pulse'], ['health & wellness']),
  icon('money', ['cash', 'dollar'], ['finances']),
  icon('wallet', ['money', 'cash'], ['finances']),
  icon('chat-circle', ['message', 'bubble'], ['communications']),
];

describe('searchIcons', () => {
  it('ranks an exact name first, then prefixes, then tag matches', () => {
    expect(searchIcons(all, 'heart', null).map((i) => i.name)).toEqual(['heart', 'heartbeat']);
    expect(searchIcons(all, 'money', null).map((i) => i.name)).toEqual(['money', 'wallet']);
  });
  it('matches multi-word queries against hyphenated names', () => {
    expect(searchIcons(all, 'chat circle', null).map((i) => i.name)).toEqual(['chat-circle']);
  });
  it('filters by category, with or without a query', () => {
    expect(searchIcons(all, '', 'finances').map((i) => i.name)).toEqual(['money', 'wallet']);
    expect(searchIcons(all, 'pulse', 'finances')).toEqual([]);
  });
  it('returns everything for an empty query', () => {
    expect(searchIcons(all, '  ', null)).toHaveLength(all.length);
  });
});

describe('withColor', () => {
  it('replaces every currentColor', () => {
    expect(withColor('<svg fill="currentColor"><path fill="currentColor"/></svg>', '#ff0000')).toBe('<svg fill="#ff0000"><path fill="#ff0000"/></svg>');
  });
});
