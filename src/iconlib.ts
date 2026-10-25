/** The bundled icon library: Phosphor Icons (MIT), about 1,500 icons in four weights. */

export type IconWeight = 'regular' | 'bold' | 'fill' | 'duotone';

export const WEIGHTS: { id: IconWeight; label: string }[] = [
  { id: 'regular', label: 'Outline' },
  { id: 'bold', label: 'Bold' },
  { id: 'fill', label: 'Filled' },
  { id: 'duotone', label: 'Duotone' },
];

export interface IconMeta {
  name: string;
  label: string;
  categories: string[];
  tags: string[];
}

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'communications', label: 'Chat' },
  { id: 'media', label: 'Media' },
  { id: 'finances', label: 'Money' },
  { id: 'commerce', label: 'Shopping' },
  { id: 'health & wellness', label: 'Health' },
  { id: 'maps & travel', label: 'Travel' },
  { id: 'weather', label: 'Weather' },
  { id: 'nature', label: 'Nature' },
  { id: 'games', label: 'Games' },
  { id: 'office', label: 'Office' },
  { id: 'objects', label: 'Objects' },
  { id: 'people', label: 'People' },
  { id: 'design', label: 'Design' },
  { id: 'technology & development', label: 'Tech' },
  { id: 'system', label: 'System' },
  { id: 'arrows', label: 'Arrows' },
];

/** Shown first when nothing is searched. */
export const POPULAR = [
  'heart', 'star', 'chat-circle-dots', 'camera', 'music-notes', 'house', 'lightning', 'rocket-launch', 'leaf', 'sun',
  'moon', 'cloud', 'fire', 'gift', 'shopping-bag', 'wallet', 'coins', 'chart-line-up', 'calendar', 'clock',
  'map-pin', 'airplane-tilt', 'car', 'bicycle', 'barbell', 'heartbeat', 'pill', 'coffee', 'pizza', 'hamburger',
  'book-open', 'graduation-cap', 'pencil-simple', 'paint-brush', 'palette', 'image', 'video-camera', 'microphone', 'headphones', 'game-controller',
  'puzzle-piece', 'trophy', 'crown', 'diamond', 'sparkle', 'magic-wand', 'robot', 'code', 'terminal-window', 'cpu',
  'shield-check', 'lock-key', 'key', 'fingerprint', 'bell', 'envelope-simple', 'paper-plane-tilt', 'phone', 'user', 'users-three',
  'smiley', 'paw-print', 'tree', 'flower', 'globe', 'compass', 'mountains', 'umbrella', 'snowflake', 'drop',
];

let catalog: Promise<IconMeta[]> | null = null;

export function loadCatalog(): Promise<IconMeta[]> {
  catalog ??= import('@phosphor-icons/core').then(({ icons }) =>
    icons.map((i) => ({
      name: i.name,
      label: i.pascal_name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
      categories: [...i.categories] as string[],
      tags: ([...i.tags] as string[]).filter((t) => !t.startsWith('*')),
    })),
  );
  return catalog;
}

const SETS: Record<IconWeight, () => Promise<{ default: Record<string, string> }>> = {
  regular: () => import('./iconsets/regular'),
  bold: () => import('./iconsets/bold'),
  fill: () => import('./iconsets/fill'),
  duotone: () => import('./iconsets/duotone'),
};

const sets = new Map<IconWeight, Promise<Map<string, string>>>();

/** All icons of one weight, keyed by icon name. */
export function loadWeight(weight: IconWeight): Promise<Map<string, string>> {
  let p = sets.get(weight);
  if (!p) {
    p = SETS[weight]().then((m) => {
      const out = new Map<string, string>();
      for (const [path, svg] of Object.entries(m.default)) {
        const file = path.slice(path.lastIndexOf('/') + 1);
        out.set(file.replace(/(-(bold|fill|duotone))?\.svg$/, ''), svg);
      }
      return out;
    });
    p.catch(() => sets.delete(weight));
    sets.set(weight, p);
  }
  return p;
}

/** One icon's SVG with its colour filled in (Phosphor uses currentColor). */
export async function iconSvg(name: string, weight: IconWeight, color = '#ffffff'): Promise<string> {
  const svg = (await loadWeight(weight)).get(name);
  if (!svg) throw new Error(`Icon "${name}" is not in the library.`);
  return withColor(svg, color);
}

export function withColor(svg: string, color: string) {
  return svg.replace(/currentColor/g, color);
}

/**
 * Icons matching a search and category, best first: exact or prefix name matches,
 * then name contains, then tag matches.
 */
export function searchIcons(all: IconMeta[], query: string, category: string | null): IconMeta[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '-');
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pool = category ? all.filter((i) => i.categories.includes(category)) : all;
  if (!q) {
    // Lead with icons people reach for most, instead of the alphabet's arrows and align tools.
    const rank = new Map(POPULAR.map((n, i) => [n, i]));
    return [...pool].sort((a, b) => (rank.get(a.name) ?? 1e6) - (rank.get(b.name) ?? 1e6));
  }
  const scored: { icon: IconMeta; score: number }[] = [];
  for (const icon of pool) {
    let score = 0;
    if (icon.name === q) score = 100;
    else if (icon.name.startsWith(q)) score = 80;
    else if (icon.name.includes(q)) score = 60;
    else if (words.every((w) => icon.name.includes(w) || icon.tags.some((t) => t.includes(w)) || icon.categories.some((c) => c.includes(w))))
      score = 30;
    if (score) scored.push({ icon, score: score - icon.name.length / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.icon);
}
