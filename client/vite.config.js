import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

const CERT_PATH = process.env.VITE_SSL_CERT || "./localhost+3.pem";
const KEY_PATH = process.env.VITE_SSL_KEY || "./localhost+3-key.pem";
const hasCert = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

export default defineConfig({
  plugins: [react()],
  server: {
    https: hasCert
      ? {
          key: fs.readFileSync(KEY_PATH),
          cert: fs.readFileSync(CERT_PATH),
        }
      : undefined,
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
