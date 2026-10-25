/**
 * Bring-your-own-key AI, provider neutral. Every provider here speaks the OpenAI-compatible
 * chat completions API, called straight from the browser: no server in between.
 */

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  needsKey: boolean;
  keyUrl?: string;
  note: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    note: 'One key for hundreds of models from Anthropic, OpenAI, Google, Meta and others. Easiest place to start.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'GPT models with an OpenAI API key.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    note: "Gemini models through Google's OpenAI-compatible endpoint.",
  },
  {
    id: 'ollama',
    name: 'Ollama (on this computer)',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    note: 'Free and private. Start Ollama with OLLAMA_ORIGINS set to this site so the browser may call it.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (on this computer)',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    note: 'Free and private. Turn on the local server and CORS in LM Studio.',
  },
  {
    id: 'custom',
    name: 'Other (OpenAI-compatible)',
    baseUrl: '',
    needsKey: false,
    note: 'Any service with an OpenAI-compatible /chat/completions endpoint.',
  },
];

export interface AiSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Keep the key in localStorage; otherwise sessionStorage, gone when the tab closes. */
  remember: boolean;
}

const SETTINGS_KEY = 'iconprism:ai';
const KEY_KEY = 'iconprism:ai-key';

export function loadSettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Omit<AiSettings, 'apiKey'>;
    const apiKey = (s.remember ? localStorage.getItem(KEY_KEY) : sessionStorage.getItem(KEY_KEY)) ?? '';
    return { ...s, apiKey };
  } catch {
    return null;
  }
}

export function saveSettings(s: AiSettings) {
  const { apiKey, ...rest } = s;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
    localStorage.removeItem(KEY_KEY);
    sessionStorage.removeItem(KEY_KEY);
    if (apiKey) (s.remember ? localStorage : sessionStorage).setItem(KEY_KEY, apiKey);
  } catch {
    /* storage blocked: settings last for this page only */
  }
}

export function isReady(s: AiSettings | null): s is AiSettings {
  if (!s || !s.baseUrl || !s.model) return false;
  const p = PROVIDERS.find((x) => x.id === s.provider);
  return !p?.needsKey || !!s.apiKey;
}

function headers(s: AiSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.apiKey) h.Authorization = `Bearer ${s.apiKey}`;
  if (s.provider === 'openrouter') {
    // Optional attribution headers OpenRouter shows in its dashboard.
    h['HTTP-Referer'] = location.origin;
    h['X-Title'] = 'iconprism';
  }
  return h;
}

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Explains the common failures in plain words. */
async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? body?.message ?? '';
  } catch {
    /* not JSON */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? 'The provider rejected the key. Check it in AI settings.'
      : res.status === 402
        ? 'Your provider account is out of credit.'
        : res.status === 404
          ? 'The model or address was not found. Check the model name in AI settings.'
          : res.status === 429
            ? 'Too many requests. Wait a moment and try again.'
            : `The provider answered with an error (${res.status}).`;
  return new Error(detail ? `${hint} ${detail}` : hint);
}

function networkError(err: unknown, s: AiSettings): Error {
  if ((err as Error)?.name === 'AbortError') return err as Error;
  const local = /localhost|127\.0\.0\.1/.test(s.baseUrl);
  return new Error(
    local
      ? 'Could not reach the local model. Is it running, with browser access (CORS) allowed?'
      : 'Could not reach the provider. Check your connection and the base URL; some providers block calls from browsers.',
  );
}

/** Model ids the provider offers, newest first when it says when they were added. */
export async function listModels(s: AiSettings, signal?: AbortSignal): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${trimSlash(s.baseUrl)}/models`, { headers: headers(s), signal });
  } catch (err) {
    throw networkError(err, s);
  }
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  const list: { id: string; created?: number }[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list
    .filter((m) => typeof m.id === 'string')
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((m) => m.id.replace(/^models\//, ''));
}

/** A reasonable first pick from a model list: a recent strong general model if there is one. */
export function suggestModel(ids: string[]): string {
  const prefer = [/^anthropic\/claude-(opus|sonnet)/, /^openai\/gpt-5/, /^google\/gemini-.*pro/, /^gpt-5/, /^gemini-.*pro/, /^anthropic\//, /^openai\//];
  for (const re of prefer) {
    const hit = ids.find((id) => re.test(id) && !/(free|preview|audio|image|embed|search|realtime|tts)/.test(id));
    if (hit) return hit;
  }
  return ids[0] ?? '';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(s: AiSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${trimSlash(s.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: headers(s),
      body: JSON.stringify({ model: s.model, messages }),
      signal,
    });
  } catch (err) {
    throw networkError(err, s);
  }
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  // Some providers return content as an array of parts.
  const text = Array.isArray(content) ? content.map((p: { text?: string }) => p?.text ?? '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The model sent back an empty answer. Try again, or pick another model.');
  return text;
}

// ---------------------------------------------------------------- prompts

export const SYSTEM_PROMPT = `You are an expert app icon designer. You reply with exactly one SVG document and nothing else: no explanation, no Markdown.

Rules for the SVG:
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">.
- The first child is the background: <rect x="0" y="0" width="1024" height="1024" fill="..."/>, a solid colour or a linearGradient. No rounded corners; phones apply their own mask.
- Use only: g, rect, circle, ellipse, polygon, polyline, path, line, linearGradient, radialGradient, stop, defs.
- No <text> (draw letters as paths if needed), no <image>, <style>, <script>, filters, masks, clipPath, or external references.
- Prefer filled shapes over strokes. Strokes only for simple lines, with stroke-linecap="round".
- Keep the main artwork inside a centred circle 820 units across, so circular masks never cut it.
- Design for small sizes: one clear idea, 1 to 4 main shapes, strong contrast, flat colours or one subtle gradient. Recognisable at 48 pixels.`;

export function buildMessages(mode: 'generate' | 'edit', request: string, currentSvg?: string): ChatMessage[] {
  const user =
    mode === 'edit' && currentSvg
      ? `Here is the current app icon:\n\n${currentSvg}\n\nChange it as follows: ${request}\n\nKeep everything I did not ask to change. Return the complete updated SVG.`
      : `Design an app icon: ${request}`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export const EXAMPLES = [
  'A friendly cloud with a lightning bolt, blue gradient',
  'Minimal leaf for a plant care app, deep green',
  'Rocket taking off, bold orange and navy',
  'Coffee cup with steam, warm brown',
  'Shield with a check mark for a password manager',
  'Music note in a speech bubble, purple',
];

// ---------------------------------------------------------------- SVG safety

/** The first SVG document in a reply, from a ```svg block or bare markup. */
export function extractSvg(text: string): string | null {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : null;
}

const BLOCKED = new Set(['script', 'foreignobject', 'image', 'style', 'iframe', 'object', 'embed', 'a', 'audio', 'video', 'animate', 'animatetransform', 'animatemotion', 'set']);

/**
 * Removes anything that could load or run something: scripts, embedded documents, images,
 * event handlers and links to other documents. Only the drawing remains.
 */
export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('The model did not return a valid SVG. Try again.');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (BLOCKED.has(child.localName.toLowerCase())) child.remove();
      else walk(child);
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) el.removeAttribute(attr.name);
      else if (/javascript:|url\(\s*['"]?(?!#)/.test(value)) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  return new XMLSerializer().serializeToString(root);
}
