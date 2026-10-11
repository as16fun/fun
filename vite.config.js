import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build can live in any sub-folder of a portfolio site or be iframed.
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600, // MapLibre is ~800 KB minified; it is split into its own chunk
    rollupOptions: {
      // index.html: the career journey · dispatch.html: the newsroom story-map concept
      input: {
        main: 'index.html',
        dispatch: 'dispatch.html',
        'case-studies': 'case-studies/index.html',
        'us-election-2020': 'case-studies/us-election-2020/index.html',
        'story-maps': 'case-studies/story-maps/index.html',
        'brand-brain': 'case-studies/brand-brain/index.html',
      },
      output: {
        manualChunks: (id) => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
  server: { port: 5173, strictPort: false },
});
