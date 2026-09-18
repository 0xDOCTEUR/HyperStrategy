import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/hl-api': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hl-api/, ''),
      },
    },
  },
});
