import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// We only enable the self-signed HTTPS plugin when started with `--mode https`
// (via `npm run dev:https`). The iPhone needs HTTPS to grant camera access over
// the local network. On the MacBook itself, plain `npm run dev` (http://localhost)
// is already treated as a "secure context" by browsers, so the camera works there
// without any certificate.
export default defineConfig(({ command, mode }) => ({
  // Served at https://<user>.github.io/silenttype/ in production, root in dev.
  base: command === "build" ? "/silenttype/" : "/",
  plugins: mode === "https" ? [basicSsl()] : [],
  server: {
    host: true, // listen on 0.0.0.0 so the iPhone can reach it over Wi-Fi
    port: 5173,
  },
  // MediaPipe ships WASM assets; make sure they are not mangled.
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
