# iconprism

Draw an app icon with simple vector tools, then export every iOS, Android and web size in one ZIP.

Free, open source, and it runs entirely in your browser. Nothing is uploaded.

**Use it:** https://boysugi20.github.io/iconprism/

## What it does

- **Draw:** rectangle (with corner radius), ellipse, polygon, star, line and pen (curves) on a 1024 × 1024 artboard.
- **Text:** type directly on the canvas in 13 bundled fonts or your own .ttf/.otf/.woff, with weight, size, alignment, letter spacing and line height. Text is stored as vector outlines, so it exports exactly, works with Union and Subtract, and stays editable (double-click it).
- **Edit:** move, resize with handles, rotate, flip, align, reorder, group, and drag individual points and curve handles.
- **Combine:** union (merge), subtract, intersect and exclude.
- **Style:** solid or gradient fills, strokes, opacity, and a solid or gradient background.
- **Guides:** iOS mask outline, Android safe zone and centre lines.
- **Preview:** live iOS, Android and favicon previews while you draw.
- **Import and export SVG,** plus a 1024 px PNG.
- **Export icon set:** one ZIP with everything below.

Your work is saved in the browser automatically.

## What the ZIP contains

| Platform | Files |
| --- | --- |
| iOS | `AppIcon.appiconset` with a 1024 px icon and `Contents.json` (Xcode 14+ builds the other sizes) |
| Android | `mipmap-mdpi` to `mipmap-xxxhdpi`: legacy, round, adaptive foreground, background and monochrome layers; `mipmap-anydpi-v26` XML; Play Store 512 px |
| Web | `favicon.ico` (16/32/48), `favicon.svg`, `apple-touch-icon.png`, 192/512 PNGs, a maskable icon, `manifest.webmanifest` and a `<head>` snippet |

Install steps for each platform, including Flutter paths, are in the ZIP's `README.txt`.

### How the artboard maps to each platform

- **iOS** uses the whole artboard. iOS rounds the corners itself; the yellow guide shows roughly where.
- **Android adaptive icons** use a 108 dp canvas where only the centre 72 dp is visible. The artboard fills that centre 72 dp and the background extends to the edges. Keep important artwork inside the Android safe-zone guide, because some launchers crop to a circle.
- **iOS and store icons** cannot be transparent. If the background is off, they get a solid colour behind the artwork.

## Shortcuts

| Key | Action |
| --- | --- |
| V, A | Select, edit points |
| R, O, Y, S | Rectangle, ellipse, polygon, star |
| L, P, T | Line, pen, text |
| Enter | Edit the selected text; finish typing (Shift+Enter for a new line) |
| Shift | Square, circle or 45° while drawing; add to selection |
| Alt | Draw from the centre; break curve handle symmetry |
| ⌘Z, ⇧⌘Z | Undo, redo |
| ⌘D, ⌘G, ⇧⌘G | Duplicate, group, ungroup |
| ⌘C, ⌘X, ⌘V | Copy, cut, paste |
| Arrows | Nudge 1 px (Shift: 10 px) |
| Space + drag, scroll | Pan |
| ⌘ + scroll, pinch | Zoom |
| ⇧1, ⌘0 | Fit artboard |

Use Ctrl in place of ⌘ on Windows and Linux.

## Develop

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages through `.github/workflows/pages.yml`.

Built with [Paper.js](http://paperjs.org) for vector editing and boolean operations, [opentype.js](https://opentype.js.org) for turning text into outlines, and [JSZip](https://stuk.github.io/jszip/) for the export. Bundled fonts come from [Fontsource](https://fontsource.org) under the SIL Open Font License.

## License

MIT
