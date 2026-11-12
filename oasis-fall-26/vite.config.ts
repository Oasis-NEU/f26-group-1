import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // The compare page imports ../scraping/data/field_catalog.json (the scraper/UI contract).
      // Paths are relative to this folder; '.' keeps the default (the project itself).
      allow: ['.', '../scraping/data'],
    },
  },
})
