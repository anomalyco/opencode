import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3210",
      "/ws": {
        target: "ws://localhost:3210",
        ws: true,
      },
    },
  },
});
