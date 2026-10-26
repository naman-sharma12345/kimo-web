import js from '@eslint/js';
import ts from 'typescript-eslint';
import next from '@next/eslint-plugin-next';
import a11y from 'eslint-plugin-jsx-a11y';
export default ts.config(
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '.agents/**',
      '.codex/**',
      'test-results/**',
      'playwright-report/**',
      'apps/web/next-env.d.ts',
    ],
  },
  { plugins: { '@next/next': next } },
  js.configs.recommended,
  ...ts.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        WebSocket: 'readonly',
        XMLHttpRequest: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        HTMLVideoElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLElement: 'readonly',
        AbortController: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        createImageBitmap: 'readonly',
        OfflineAudioContext: 'readonly',
        OffscreenCanvas: 'readonly',
        Image: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        ProgressEvent: 'readonly',
        IDBDatabase: 'readonly',
        IDBOpenDBRequest: 'readonly',
        DOMException: 'readonly',
      },
    },
    plugins: { 'jsx-a11y': a11y },
    rules: {
      ...next.configs.recommended.rules,
      ...a11y.flatConfigs.recommended.rules,
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['apps/web/src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Use design tokens, never raw hex colors in components.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
