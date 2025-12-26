import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useHttps = env.VITE_DEV_SSL === "1";
  const certPath = env.VITE_SSL_CERT || "./localhost+3.pem";
  const keyPath = env.VITE_SSL_KEY || "./localhost+3-key.pem";

  // Pfade relativ zur vite.config.js (robust auch unter Windows)
  const resolvedCert = path.resolve(CONFIG_DIR, certPath);
  const resolvedKey = path.resolve(CONFIG_DIR, keyPath);
  const hasCert = useHttps && fs.existsSync(resolvedCert) && fs.existsSync(resolvedKey);

  return {
    plugins: [react()],
    server: {
      https:
        hasCert && useHttps
          ? {
              key: fs.readFileSync(resolvedKey),
              cert: fs.readFileSync(resolvedCert),
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
  };
});
