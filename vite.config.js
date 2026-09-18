import { defineConfig } from 'vite';

export default defineConfig({
  // URL GitHub Pages : https://0xdocteur.github.io/HyperStrategy/
  base: '/HyperStrategy/',
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
  preview: {
    port: 5173,
  },
});
