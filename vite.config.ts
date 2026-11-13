import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // WebView2 is evergreen Chromium.
  build: { target: "es2022", chunkSizeWarningLimit: 2400 },
  // The language servers run in module workers, which may split into chunks.
  worker: { format: "es" },
  // The Java formatter loads two WebAssembly files next to its own modules;
  // pre-bundling would move the modules away from them.
  optimizeDeps: { esbuildOptions: { target: "es2022" }, exclude: ["prettier-plugin-java", "web-tree-sitter"] },

  test: { environment: "node" },

  // Vite options tailored for Tauri development, only applied in `tauri dev` or `tauri build`.
  // 1. Keep Rust errors visible.
  clearScreen: false,
  // 2. Tauri expects a fixed port; fail if it is taken.
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    // 3. Don't watch the Rust side.
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
