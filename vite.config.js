import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind to every interface, not just localhost, so the dev server can be opened from a phone on
    // the same Wi-Fi — the iOS-specific behaviour this app has to get right (status bar colour,
    // input auto-zoom, safe-area insets) can only really be checked on a real device.
    host: true,
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
})
