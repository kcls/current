/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverHost = process.env.VITE_SERVER_HOST || 'localhost';
const serverPort = parseInt(process.env.VITE_SERVER_PORT || '3001', 10);

const defaultAllowedHosts = ['localhost', '127.0.0.1'];
const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map(h => h.trim())
  : defaultAllowedHosts;
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:30080';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Local copy of the former @odo/core package (see
      // docs/current-split-development-plan.md, Phase 2c).
      '@core': new URL('./src/core', import.meta.url).pathname,
    },
  },
  base: '/incident-tracker',

  // Dev server configuration
  server: {
    port: serverPort,
    host: serverHost,
    strictPort: false,
    open: true,
    allowedHosts,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        cookieDomainRewrite: '',
      },
    },
  },

  // Preview server configuration (for testing production builds locally)
  preview: {
    port: serverPort,
    host: serverHost,
    strictPort: false,
    allowedHosts,
  },

  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': ['@mui/material', '@mui/icons-material'],
        },
      },
    },
  },

  // Dependency optimization
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@mui/material',
    ],
  },

  // Vitest configuration
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/shared/**/*.{ts,tsx}',
        'src/features/**/*.{ts,tsx}',
        'src/contexts/**/*.{ts,tsx}',
        'src/components/**/*.{ts,tsx}',
        'src/pages/**/*.{ts,tsx}',
        'src/utils/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/tests/**',
        'src/**/index.ts',
        'src/types/**',
      ],
    },
  },
});
