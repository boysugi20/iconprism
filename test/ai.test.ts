// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildMessages, extractSvg, isReady, sanitizeSvg, suggestModel } from '../src/ai';

describe('extractSvg', () => {
  it('finds the SVG inside chatter and code fences', () => {
    expect(extractSvg('Here you go:\n```svg\n<svg viewBox="0 0 1 1"><rect/></svg>\n```\nEnjoy')).toBe('<svg viewBox="0 0 1 1"><rect/></svg>');
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
