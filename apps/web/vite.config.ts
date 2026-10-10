import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    // Loopback by default. `HOST=0.0.0.0 npm run dev` exposes the dev server
    // to phones on a trusted network (docs/MOBILE_APP.md); /api stays proxied.
    host: process.env.HOST || "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 700 },
});
