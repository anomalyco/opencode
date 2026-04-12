import { defineConfig, loadEnv } from "vite"
import desktopPlugin from "./vite"

const axiomOtlpProxy = (axiomHost: string) => ({
  "/__veritly/axiom-otlp-traces": {
    target: axiomHost,
    changeOrigin: true,
    rewrite: () => "/v1/traces",
  },
})

function devApiProxy(target: string) {
  const t = target.replace(/\/+$/, "")
  const origin = new URL(t).origin
  return {
    "/api": {
      target: t,
      changeOrigin: true,
      secure: true,
      ws: true,
      /** Some CDNs reject WS when `Origin: http://localhost:3000`; upstream expects its own origin. */
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader("origin", origin)
        })
        proxy.on("proxyReqWs", (proxyReq) => {
          proxyReq.setHeader("origin", origin)
        })
      },
    },
  } as const
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const axiomHost = (env.VITE_PUBLIC_AXIOM_URL || "https://api.axiom.co").replace(/\/+$/, "")
  /** Forward `/api/*` (HTTP + WebSocket) to hosted edge so `VITE_UNIVER_SDK_WS=/api/...` is same-origin in dev. */
  const devProxyTarget = env.DEV_PROXY_TARGET?.trim()

  return {
    plugins: [desktopPlugin] as any,
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 3000,
      proxy: {
        ...axiomOtlpProxy(axiomHost),
        ...(devProxyTarget ? devApiProxy(devProxyTarget) : {}),
      },
    },
    preview: {
      proxy: {
        ...axiomOtlpProxy(axiomHost),
        ...(devProxyTarget ? devApiProxy(devProxyTarget) : {}),
      },
    },
    build: {
      target: "esnext",
    },
  }
})
