import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 80,
    host: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  base: './'
}) 