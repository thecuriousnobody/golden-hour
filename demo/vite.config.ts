import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiPlugin } from './vite-api-plugin'

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 3000,
  },
})
