import JSZip from 'jszip';
import { drawAdaptive, drawAdaptiveBg, drawAdaptiveFg, drawForeground, drawFull, ico, loadImages, png, pngRGB, type IconSvgs } from './render';

export interface ExportOptions {
  name: string;
  ios: boolean;
  android: boolean;
  web: boolean;
  /** Shown under the artboard when the icon has no background; iOS and stores need opaque art. */
  opaqueColor: string;
  /** iOS 18 dark and tinted appearances. */
  iosVariants?: boolean;
  /** Extra square PNG sizes, written to png/. */
  extraSizes?: number[];
}

/** Parses "64, 128 256" into valid sizes (16 to 4096 px), without duplicates. */
export function parseSizes(text: string): number[] {
  const sizes = text
    .split(/[\s,;]+/)
    .map((t) => Number(t.replace(/px$/i, '')))
    .filter((n) => Number.isInteger(n) && n >= 16 && n <= 4096);
  return [...new Set(sizes)].sort((a, b) => a - b);
}

const DENSITIES: [string, number][] = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

function iosContents(variants: boolean) {
  const base = { idiom: 'universal', platform: 'ios', size: '1024x1024' };
  const images: Record<string, unknown>[] = [{ ...base, filename: 'AppIcon-1024.png' }];
  if (variants)
    images.push(
      { ...base, filename: 'AppIcon-Dark-1024.png', appearances: [{ appearance: 'luminosity', value: 'dark' }] },
      { ...base, filename: 'AppIcon-Tinted-1024.png', appearances: [{ appearance: 'luminosity', value: 'tinted' }] },
    );
  return { images, info: { author: 'iconprism', version: 1 } };
}

export function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
}

function readme(o: ExportOptions) {
  const lines = [`${o.name} icons, made with iconprism`, ''];
  if (o.ios)
    lines.push(
      'iOS',
      '  Replace your project\'s AppIcon.appiconset with ios/AppIcon.appiconset.',
      '  Xcode 14 or later builds every size from the single 1024 px image.',
      '  Flutter: ios/Runner/Assets.xcassets/AppIcon.appiconset',
      '',
    );
  if (o.android)
    lines.push(
      'Android',
      '  Copy the folders in android/res into app/src/main/res (merge, overwrite).',
      '  Flutter: android/app/src/main/res',
      '  Upload android/play-store-512.png as the Play Store icon.',
      '  Themed icons (Android 13+) tint the shape of ic_launcher_monochrome, so a',
      '  large solid shape in the foreground shows as a solid block when themed.',
      '',
    );
  if (o.web)
    lines.push(
      'Web',
      '  Put the files in web/ at your site root and paste head-snippet.html into <head>.',
      '  manifest.webmanifest lists the PWA icons, including a maskable one.',
      '',
    );
  return lines.join('\n');
}

export async function buildZip(svgs: IconSvgs, o: ExportOptions): Promise<Blob> {
  const imgs = await loadImages(svgs);
  const zip = new JSZip();
  const root = zip.folder(`${slug(o.name)}-icons`)!;
  const opaque = svgs.bg ? undefined : o.opaqueColor;

  root.file('icon.svg', svgs.full);
  root.file('icon-1024.png', await png(drawFull(imgs, 1024)));
  root.file('README.txt', readme(o));

  if (o.ios) {
    const set = root.folder('ios/AppIcon.appiconset')!;
    set.file('AppIcon-1024.png', await pngRGB(drawFull(imgs, 1024, 'none', opaque ?? '#000000')));
    if (o.iosVariants) {
      // Dark: artwork on transparent, iOS draws its own dark backdrop. Tinted: greyscale on black.
      set.file('AppIcon-Dark-1024.png', await png(drawForeground(imgs, 1024)));
      set.file('AppIcon-Tinted-1024.png', await pngRGB(drawForeground(imgs, 1024, { grayscale: true, under: '#000000' })));
    }
    set.file('Contents.json', JSON.stringify(iosContents(!!o.iosVariants), null, 2));
  }

  if (o.android) {
    const res = root.folder('android/res')!;
    for (const [dpi, scale] of DENSITIES) {
      const dir = res.folder(`mipmap-${dpi}`)!;
      const legacy = Math.round(48 * scale);
      const layer = Math.round(108 * scale);
      // Legacy launchers (before Android 8) show the artboard itself through a fixed mask.
      dir.file('ic_launcher.png', await png(drawFull(imgs, legacy, 'rounded')));
      dir.file('ic_launcher_round.png', await png(drawFull(imgs, legacy, 'circle')));
      dir.file('ic_launcher_foreground.png', await png(drawAdaptiveFg(imgs, layer)));
      dir.file('ic_launcher_background.png', await png(drawAdaptiveBg(imgs, layer)));
      dir.file('ic_launcher_monochrome.png', await png(drawAdaptiveFg(imgs, layer)));
    }
    const anydpi = res.folder('mipmap-anydpi-v26')!;
    anydpi.file('ic_launcher.xml', ADAPTIVE_XML);
    anydpi.file('ic_launcher_round.xml', ADAPTIVE_XML);
    root.file('android/play-store-512.png', await png(drawFull(imgs, 512, 'none', opaque ?? '#000000')));
  }

  if (o.web) {
    const web = root.folder('web')!;
    const favs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(drawFull(imgs, size)) })));
    web.file('favicon.ico', ico(favs));
    web.file('favicon.svg', svgs.full);
    web.file('apple-touch-icon.png', await png(drawFull(imgs, 180, 'none', opaque ?? '#ffffff')));
    web.file('icon-192.png', await png(drawFull(imgs, 192)));
    web.file('icon-512.png', await png(drawFull(imgs, 512)));
    web.file('icon-maskable-512.png', await png(drawAdaptive(imgs, 512)));
    web.file(
      'manifest.webmanifest',
      JSON.stringify(
        {
          name: o.name,
          short_name: o.name,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        null,
        2,
      ),
    );
    web.file(
      'head-snippet.html',
      [
        '<link rel="icon" href="/favicon.ico" sizes="48x48">',
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        '',
      ].join('\n'),
    );
  }

  for (const size of o.extraSizes ?? []) root.file(`png/icon-${size}.png`, await png(drawFull(imgs, size)));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
