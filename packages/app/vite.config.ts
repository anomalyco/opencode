import { defineConfig, loadEnv } from "vite"
import desktopPlugin from "./vite"

const axiomOtlpProxy = (axiomHost: string) => ({
  "/__veritly/axiom-otlp-traces": {
    target: axiomHost,
    changeOrigin: true,
    rewrite: () => "/v1/traces",
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const axiomHost = (env.VITE_PUBLIC_AXIOM_URL || "https://api.axiom.co").replace(/\/+$/, "")

  return {
    plugins: [desktopPlugin] as any,
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 3000,
      proxy: axiomOtlpProxy(axiomHost),
    },
    preview: {
      proxy: axiomOtlpProxy(axiomHost),
    },
    build: {
      target: "esnext",
    },
  }
})
