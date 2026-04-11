import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const debug = process.env.VERITLY_DEBUG_BUILD === "1"
/** Full `.map` files are memory-heavy in CI/Docker; enable only when you have RAM (e.g. local). Unminified bundles are still readable without this. */
const debugSourcemap = process.env.VERITLY_DEBUG_SOURCEMAP === "1"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    minify: debug ? false : "esbuild",
    cssMinify: debug ? false : true,
    sourcemap: debug && debugSourcemap ? true : false,
  },
})
