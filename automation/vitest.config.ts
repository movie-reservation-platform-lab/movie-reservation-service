import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: process.cwd(),
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: {
          syntax: 'typescript',
        },
      },
    }),
  ],
  oxc: false,
  test: {
    include: ['automation/**/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
