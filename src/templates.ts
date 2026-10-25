import paper from 'paper/dist/paper-core';
import { applyFill, solid, type Editor, type Fill } from './editor';

export interface Template {
  id: string;
  name: string;
  hint: string;
  /** Small preview drawn by hand; it only has to read as the same idea. */
  thumb: string;
  background: { enabled: boolean; fill: Fill };
  build(editor: Editor): Promise<void> | void;
}

const linear = (color: string, color2: string, angle = 90): Fill => ({ type: 'linear', color, color2, angle });
const C = new paper.Point(512, 512);

function shape(item: paper.Item, fill: Fill) {
  applyFill(item, fill);
  return item;
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    hint: 'White artboard, nothing on it',
    thumb: '<rect width="64" height="64" rx="14" fill="#fff"/>',
    background: { enabled: true, fill: solid('#ffffff') },
    build() {},
  },
  {
    id: 'monogram',
    name: 'Monogram',
    hint: 'One bold letter on a gradient',
    thumb: '<defs><linearGradient id="t1" x2="0" y2="1"><stop stop-color="#7b6cff"/><stop offset="1" stop-color="#3b2bb8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#t1)"/><path d="M22 46 32 17l10 29h-6l-2-6h-4l-2 6zm10-12h3l-1.5-6z" fill="#fff"/>',
    background: { enabled: true, fill: linear('#7b6cff', '#3b2bb8') },
    async build(editor) {
      await editor.writeText(null, new paper.Point(512, 712), { content: 'A', font: 'montserrat', weight: 900, size: 600, align: 'center', spacing: 0, lineHeight: 1 }, { silent: true, fill: solid('#ffffff') });
    },
  },
  {
    id: 'badge',
    name: 'Badge',
    hint: 'Star inside a ring',
    thumb: '<rect width="64" height="64" rx="14" fill="#13151c"/><circle cx="32" cy="32" r="19" fill="#ffd43b"/><path d="m32 20 3.5 7.4 8 .9-6 5.5 1.7 8L32 37.9l-7.2 3.9 1.7-8-6-5.5 8-.9z" fill="#13151c"/>',
    background: { enabled: true, fill: linear('#1f2230', '#0c0d12') },
    build() {
      shape(new paper.Path.Circle(C, 320), linear('#ffe066', '#ff922b', 120));
      shape(new paper.Path.Star(C, 5, 210, 95), solid('#13151c'));
    },
  },
  {
    id: 'chat',
    name: 'Chat bubble',
    hint: 'Rounded bubble with a tail',
    thumb: '<rect width="64" height="64" rx="14" fill="#1fbf6a"/><path d="M16 20a5 5 0 0 1 5-5h22a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H29l-8 7v-7a5 5 0 0 1-5-5z" fill="#fff"/>',
    background: { enabled: true, fill: linear('#34d27c', '#128a4b') },
    build() {
      const body = new paper.Path.Rectangle(new paper.Rectangle(232, 262, 560, 400), new paper.Size(90, 90));
      const tail = new paper.Path({ segments: [[330, 620], [470, 620], [320, 780]], closed: true });
      const bubble = body.unite(tail);
      body.remove();
      tail.remove();
      shape(bubble, solid('#ffffff'));
      for (const x of [392, 512, 632]) shape(new paper.Path.Circle(new paper.Point(x, 462), 38), solid('#1fbf6a'));
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    hint: 'Triangle with a cut-out',
    thumb: '<rect width="64" height="64" rx="14" fill="#1c1c21"/><path d="M32 13 52 47H12z" fill="#c9f75b"/><path d="M32 30 38 41H26z" fill="#1c1c21"/>',
    background: { enabled: true, fill: linear('#2a2a31', '#0d0d10') },
    build() {
      const prism = new paper.Path.RegularPolygon(new paper.Point(512, 566), 3, 330);
      shape(prism, linear('#e4ff4f', '#4ff0c8', 60));
      shape(new paper.Path.RegularPolygon(new paper.Point(512, 566), 3, 120), solid('#0d0d10'));
    },
  },
  {
    id: 'stack',
    name: 'Stack',
    hint: 'Three overlapping tiles',
    thumb: '<rect width="64" height="64" rx="14" fill="#141418"/><rect x="14" y="14" width="24" height="24" rx="5" fill="#ff5ec8"/><rect x="20" y="20" width="24" height="24" rx="5" fill="#4ff0c8"/><rect x="26" y="26" width="24" height="24" rx="5" fill="#e4ff4f"/>',
    background: { enabled: true, fill: linear('#232329', '#0b0b0e') },
    build() {
      const tile = (x: number, color: string) =>
        shape(new paper.Path.Rectangle(new paper.Rectangle(x, x, 420, 420), new paper.Size(90, 90)), solid(color));
      tile(212, '#ff5ec8');
      tile(302, '#4ff0c8');
      tile(392, '#e4ff4f');
    },
  },
];
