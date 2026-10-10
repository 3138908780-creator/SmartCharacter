import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve(import.meta.dirname, "web"),
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_SC_LOCAL_SERVICE_ORIGIN": "undefined" },
  css: { postcss: resolve(import.meta.dirname) },
  build: { outDir: resolve(import.meta.dirname, "dist-web"), emptyOutDir: true, target: "es2022" },
});
