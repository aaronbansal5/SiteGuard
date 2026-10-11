import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
const tlsKey = process.env.SITEGUARD_HTTPS_KEY;
const tlsCert = process.env.SITEGUARD_HTTPS_CERT;
if (Boolean(tlsKey) !== Boolean(tlsCert))
  throw new Error("Set both SITEGUARD_HTTPS_KEY and SITEGUARD_HTTPS_CERT");
const https =
  tlsKey && tlsCert
    ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }
    : undefined;
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    // Dedicated web host: never broaden the API listener with HOST just to
    // reach this HTTPS dev server from a phone.
    host: process.env.SITEGUARD_WEB_HOST || "127.0.0.1",
    port: 5173,
    https,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            if (https) proxyReq.setHeader("x-siteguard-public-proto", "https");
          });
        },
      },
    },
  },
  build: { chunkSizeWarningLimit: 700 },
});
