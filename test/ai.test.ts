// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildMessages, extractSvg, isReady, sanitizeSvg, suggestModel } from '../src/ai';

describe('extractSvg', () => {
  it('finds the SVG inside chatter and code fences', () => {
    expect(extractSvg('Here you go:\n```svg\n<svg viewBox="0 0 1 1"><rect/></svg>\n```\nEnjoy')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>');
  });
  it('returns null when there is no SVG', () => {
    expect(extractSvg('Sorry, I cannot draw that.')).toBeNull();
  });
});

describe('sanitizeSvg', () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
    <defs><linearGradient id="g"><stop stop-color="#000"/></linearGradient></defs>
    <script>alert(2)</script>
    <foreignObject><div>x</div></foreignObject>
    <image href="https://evil.example/a.png"/>
    <use xlink:href="https://evil.example/s.svg#a"/>
    <use href="#g"/>
    <rect width="10" height="10" fill="url(#g)" onclick="alert(3)"/>
    <circle r="2" fill="url(https://evil.example/p)"/>
  </svg>`;
  const clean = sanitizeSvg(dirty);

  it('drops scripts, embedded documents, images and event handlers', () => {
    expect(clean).not.toMatch(/script|foreignObject|<image|onload|onclick|evil\.example/i);
  });
  it('keeps the drawing and internal references', () => {
    expect(clean).toContain('fill="url(#g)"');
    expect(clean).toContain('href="#g"');
    expect(clean).toContain('<rect');
    expect(clean).toContain('<circle');
  });
  it('rejects input that is not an SVG', () => {
    expect(() => sanitizeSvg('<html><body>hi</body></html>')).toThrow();
  });
});

describe('sanitizeSvg bypass attempts', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  it('drops links hidden behind another namespace prefix', () => {
    const out = sanitizeSvg(`<svg ${NS} xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.example/a.svg#x"/></svg>`);
    expect(out).not.toContain('evil.example');
  });
  it('drops CSS escapes, image-set and remote urls in styles', () => {
    const out = sanitizeSvg(`<svg ${NS}><rect style="fill:u\\72l(https://evil.example/p)" width="1" height="1"/><rect style="fill:image-set('https://evil.example/q')"/><rect fill="url(https://evil.example/r)"/></svg>`);
    expect(out).not.toContain('evil.example');
  });
  it('drops elements from other namespaces and unknown elements', () => {
    const out = sanitizeSvg(`<svg ${NS} xmlns:h="http://www.w3.org/1999/xhtml"><h:img src="https://evil.example/i.png"/><text>hi</text><path d="M0 0h1v1z"/></svg>`);
    expect(out).not.toMatch(/evil|<text|h:img/);
    expect(out).toContain('<path');
  });
  it('drops data-* attributes so drawings cannot plant editor state', () => {
    const out = sanitizeSvg(`<svg ${NS}><path d="M0 0h9v9z" data-text="x" data-paper-data='{"rotation":5}'/></svg>`);
    expect(out).not.toContain('data-');
  });
  it('turns simple inline styles into attributes', () => {
    const out = sanitizeSvg(`<svg ${NS}><rect width="2" height="2" style="fill:#ff0000; stroke: none"/></svg>`);
    expect(out).toContain('fill="#ff0000"');
    expect(out).not.toContain('style=');
  });
});

describe('extractSvg edge cases', () => {
  it('keeps nested svg elements', () => {
    expect(extractSvg('<svg xmlns="http://www.w3.org/2000/svg"><svg><rect/></svg><circle/></svg> trailing')).toContain('<circle/></svg>');
  });
  it('adds the SVG namespace when the model leaves it out', () => {
    expect(extractSvg('<svg viewBox="0 0 1 1"><rect/></svg>')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
});

describe('suggestModel', () => {
  it('prefers a recent strong general model and skips special-purpose ones', () => {
    expect(suggestModel(['meta/llama-3', 'anthropic/claude-sonnet-5.5:free', 'anthropic/claude-sonnet-5.5', 'openai/gpt-5'])).toBe('anthropic/claude-sonnet-5.5');
    expect(suggestModel(['llama3.2', 'qwen3'])).toBe('llama3.2');
    expect(suggestModel([])).toBe('');
  });
});

describe('isReady', () => {
  const base = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm', remember: false };
  it('needs a key only for providers that require one', () => {
    expect(isReady(base)).toBe(true);
    expect(isReady({ ...base, apiKey: '' })).toBe(false);
    expect(isReady({ ...base, provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' })).toBe(true);
    expect(isReady({ ...base, model: '' })).toBe(false);
    expect(isReady(null)).toBe(false);
  });
});

describe('buildMessages', () => {
  it('sends the current SVG only when changing an icon', () => {
    expect(buildMessages('generate', 'a cat')[1].content).not.toContain('<svg');
    const edit = buildMessages('edit', 'make it red', '<svg/>');
    expect(edit[0].role).toBe('system');
    expect(edit[1].content).toContain('<svg/>');
    expect(edit[1].content).toContain('make it red');
  });
});
