import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin for the GUI and the API, so the login cookie just works.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
