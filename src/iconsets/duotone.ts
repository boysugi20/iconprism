// Every Phosphor icon in the duotone weight, as raw SVG. Bundled into its own chunk, loaded on first use.
export default import.meta.glob('/node_modules/@phosphor-icons/core/assets/duotone/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
