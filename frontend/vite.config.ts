import react from '@vitejs/plugin-react'
import nodePolyfills from '@rolldown/plugin-node-polyfills'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
    rolldownOptions: {
      plugins: [nodePolyfills()],
    },
  },
  build: {
    rolldownOptions: {
      plugins: [nodePolyfills()],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
