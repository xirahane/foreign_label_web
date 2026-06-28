import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    outDir: 'C:\\Users\\shirahane\\Desktop\\Opencode-test\\label_anotation_html',
    emptyOutDir: false,
    cssMinify: true,
    minify: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index-standalone.html'),
    },
  },
})
