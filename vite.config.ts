import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({ include: ['src'] }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Squiggle',
      fileName: 'squiggle',
    },
    rollupOptions: {
      // No external deps — pure DOM, ships self-contained
    },
  },
});
