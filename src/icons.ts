/** 24 px line icons. Paths only; the wrapper adds stroke styling. */
const P: Record<string, string> = {
  select: '<path d="M6 3l13 7.5-5.6 1.6L10.8 18z" fill="currentColor" stroke="none"/>',
  node: '<path d="M6 18L10 6l8 8z"/><rect x="4" y="16" width="4" height="4" fill="currentColor"/><rect x="8" y="4" width="4" height="4" fill="#0d0d0d"/><rect x="16" y="12" width="4" height="4" fill="#0d0d0d"/>',
  rect: '<rect x="4" y="5" width="16" height="14"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  polygon: '<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z"/>',
  line: '<path d="M5 19L19 5"/>',
  pen: '<path d="M12 3l5.5 9L12 21l-5.5-9z"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 3v7.4"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M8.5 20h7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  rotateCcw: '<path d="M3 4v6h6"/><path d="M3.5 15a9 9 0 102.1-9.4L3 10"/>',
  rotateCw: '<path d="M21 4v6h-6"/><path d="M20.5 15a9 9 0 11-2.1-9.4L21 10"/>',
  flipH: '<path d="M12 3v18"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z" fill="currentColor"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 9L17 3v6z"/><path d="M7 15l10 6v-6z" fill="currentColor"/>',
  unite: '<path d="M4 4h10v6h6v10H10v-6H4z" fill="currentColor"/>',
  subtract: '<path d="M4 4h10v6h-4v4H4z" fill="currentColor"/><rect x="10" y="10" width="10" height="10" stroke-dasharray="2 2"/>',
  intersect: '<rect x="4" y="4" width="10" height="10" stroke-dasharray="2 2"/><rect x="10" y="10" width="10" height="10" stroke-dasharray="2 2"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/>',
  exclude: '<path d="M4 4h10v6h6v10H10v-6H4zM10 10v4h4v-4z" fill="currentColor" fill-rule="evenodd"/>',
  alignLeft: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/>',
  alignH: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>',
  alignRight: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4"/><rect x="10" y="14" width="7" height="4"/>',
  alignTop: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12"/><rect x="14" y="7" width="4" height="7"/>',
  alignV: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 3v4M17 5h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  ai: '<path d="M10 5c.5 4 2.5 6 6.5 6.5-4 .5-6 2.5-6.5 6.5-.5-4-2.5-6-6.5-6.5 4-.5 6-2.5 6.5-6.5z" fill="currentColor" stroke="none"/><path d="M18.5 2.5c.2 1.5.9 2.2 2.4 2.4-1.5.2-2.2.9-2.4 2.4-.2-1.5-.9-2.2-2.4-2.4 1.5-.2 2.2-.9 2.4-2.4z" fill="currentColor" stroke="none"/>',
  library: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><circle cx="17" cy="7" r="3.5"/><path d="M7 13.5l3.5 6h-7z"/><path d="M17 13.5l1.1 2.3 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  shapes: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="15.5" r="5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/><path d="M10 4v8a2 2 0 0 0 4 0V4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.3 7.4A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  alignBottom: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12"/><rect x="14" y="10" width="4" height="7"/>',
};

export function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

/** Fills every element carrying data-icon="name". */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon!) + el.innerHTML;
  });
}
