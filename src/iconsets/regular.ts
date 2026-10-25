// Every Phosphor icon in the regular weight, as raw SVG. Bundled into its own chunk, loaded on first use.
export default import.meta.glob('/node_modules/@phosphor-icons/core/assets/regular/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
