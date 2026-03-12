import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  server: {
    port: 8000,
    allowedHosts: ['.coder'],
  },
  plugins: [
    dts({
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts'],
      rollupTypes: true, // Bundle all .d.ts into single file
      copyDtsFiles: false, // Don't copy individual .d.ts files
    }),
  ],
  build: {
    lib: {
      entry: 'lib/index.ts',
      name: 'GhosttyWeb',
      fileName: (format) => {
        return format === 'es' ? 'ghostty-web.js' : 'ghostty-web.umd.cjs';
      },
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: [], // No external dependencies
      output: {
        assetFileNames: 'assets/[name][extname]',
        globals: {},
      },
    },
  },
});
