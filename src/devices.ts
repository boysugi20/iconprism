/** Mock-ups that show the icon where people will meet it: home screens, a browser tab, store listings, a notification. */

export interface PreviewImages {
  /** iOS: full artboard, squircle mask. */
  ios: string;
  /** Android adaptive icon in the common shapes. */
  circle: string;
  squircle: string;
  rounded: string;
  /** Whole artboard, square, for store listings that apply their own corners. */
  square: string;
  favicon: string;
}

export type DeviceView = 'iphone' | 'android' | 'web' | 'stores';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Neutral stand-ins for other apps, so the user's icon is judged next to something. */
const FILLER = ['#ff8a65', '#4fc3f7', '#81c784', '#ffd54f', '#ba68c8', '#4db6ac', '#f06292', '#9575cd', '#aed581', '#64b5f6', '#ffb74d', '#e57373', '#7986cb', '#4dd0e1', '#a1887f', '#90a4ae'];
const FILLER_NAMES = ['Photos', 'Weather', 'Maps', 'Notes', 'Music', 'Health', 'Camera', 'Wallet', 'Books', 'Mail', 'Clock', 'News', 'Files', 'Tips', 'Store', 'Settings'];

function filler(i: number, shape: string, size: number) {
  const c = FILLER[i % FILLER.length];
  return `<span class="dv-app"><span class="dv-icon dv-fake ${shape}" style="--c:${c};--s:${size}px"></span><span class="dv-label">${FILLER_NAMES[i % FILLER_NAMES.length]}</span></span>`;
}

function mine(img: string, name: string, shape: string, size: number) {
  return `<span class="dv-app dv-mine"><img class="dv-icon ${shape}" style="--s:${size}px" src="${img}" alt=""/><span class="dv-label">${esc(name)}</span></span>`;
}

function statusBar(time = '9:41') {
  return `<div class="dv-status"><b>${time}</b><span class="dv-status-icons"><i></i><i></i><i class="batt"></i></span></div>`;
}

function iphone(p: PreviewImages, name: string) {
  const grid = [];
  for (let i = 0; i < 16; i++) grid.push(i === 5 ? mine(p.ios, name, 'sq-ios', 58) : filler(i, 'sq-ios', 58));
  const dock = [filler(9, 'sq-ios', 58), mine(p.ios, name, 'sq-ios', 58), filler(4, 'sq-ios', 58), filler(1, 'sq-ios', 58)].join('').replace(/<span class="dv-label">[^<]*<\/span>/g, '');
  return `<div class="dv-phone dv-iphone"><div class="dv-screen">${statusBar()}<div class="dv-grid">${grid.join('')}</div><div class="dv-dock">${dock}</div></div></div>`;
}

function android(p: PreviewImages, name: string) {
  const grid = [];
  for (let i = 0; i < 12; i++) grid.push(i === 6 ? mine(p.circle, name, 'sq-circle', 54) : filler(i + 3, 'sq-circle', 54));
  return `<div class="dv-phone dv-android"><div class="dv-screen">${statusBar('12:30')}<div class="dv-clock">12:30<small>Monday, 14 April</small></div><div class="dv-grid dv-grid-a">${grid.join('')}</div><div class="dv-search"></div></div></div>`;
}

function shapes(p: PreviewImages) {
  const one = (img: string, cls: string, label: string) => `<figure><img class="dv-icon ${cls}" style="--s:72px" src="${img}" alt=""/><figcaption>${label}</figcaption></figure>`;
  return `<div class="dv-card dv-shapes"><h4>Android launchers crop differently</h4><div>${one(p.circle, 'sq-circle', 'Circle')}${one(p.squircle, 'sq-squircle', 'Squircle')}${one(p.rounded, 'sq-rounded', 'Rounded square')}${one(p.ios, 'sq-ios', 'iOS')}</div><p>Keep the important part inside the dashed Android guide so every shape shows it.</p></div>`;
}

function web(p: PreviewImages, name: string) {
  return `<div class="dv-browser">
    <div class="dv-tabs">
      <span class="dv-tab"><span class="dv-fav dv-fake-fav"></span>Inbox</span>
      <span class="dv-tab on"><img class="dv-fav" src="${p.favicon}" alt=""/>${esc(name)}<i>×</i></span>
      <span class="dv-tab"><span class="dv-fav dv-fake-fav b"></span>Docs</span>
    </div>
    <div class="dv-url"><span>https://${esc(name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'myapp')}.app</span></div>
    <div class="dv-page"><div class="dv-bookmarks"><span><img src="${p.favicon}" alt=""/>${esc(name)}</span><span><i></i>Calendar</span><span><i class="b"></i>Notes</span></div></div>
  </div>
  <div class="dv-card dv-notif"><img src="${p.ios}" alt=""/><div><b>${esc(name)}</b><span>Your order is on the way and arrives today.</span></div><small>now</small></div>`;
}

function stores(p: PreviewImages, name: string) {
  return `<div class="dv-card dv-store">
    <img class="dv-icon sq-ios" style="--s:96px" src="${p.ios}" alt=""/>
    <div><b>${esc(name)}</b><span>Made for everyday use</span><button type="button" tabindex="-1">Get</button></div>
  </div>
  <div class="dv-card dv-store dv-play">
    <img class="dv-icon sq-rounded" style="--s:72px" src="${p.square}" alt=""/>
    <div><b>${esc(name)}</b><span>Productivity · 4.8 ★</span><button type="button" tabindex="-1">Install</button></div>
  </div>
  <div class="dv-card dv-search-results">
    <div class="dv-sr"><img class="dv-icon sq-ios" style="--s:48px" src="${p.ios}" alt=""/><div><b>${esc(name)}</b><span>Top result</span></div></div>
    <div class="dv-sr"><span class="dv-icon dv-fake sq-ios" style="--c:#4fc3f7;--s:48px"></span><div><b>Another app</b><span>Similar</span></div></div>
    <div class="dv-sr"><span class="dv-icon dv-fake sq-ios" style="--c:#ffb74d;--s:48px"></span><div><b>One more app</b><span>Similar</span></div></div>
  </div>`;
}

export function deviceHtml(view: DeviceView, p: PreviewImages, name: string): string {
  const n = name.trim() || 'My App';
  switch (view) {
    case 'iphone':
      return `<div class="dv-row">${iphone(p, n)}</div>`;
    case 'android':
      return `<div class="dv-row">${android(p, n)}${shapes(p)}</div>`;
    case 'web':
      return `<div class="dv-col">${web(p, n)}</div>`;
    case 'stores':
      return `<div class="dv-col">${stores(p, n)}</div>`;
  }
}
