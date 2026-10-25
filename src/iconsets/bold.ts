// Every Phosphor icon in the bold weight, as raw SVG. Bundled into its own chunk, loaded on first use.
export default import.meta.glob('/node_modules/@phosphor-icons/core/assets/bold/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
