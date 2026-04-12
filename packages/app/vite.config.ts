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
      /** Match `serve-custom-app.mjs`: public `/api/*` → OpenCode root (`/global/health`, `/univer-sdk-relay/…`). */
      rewrite: (path) => path.replace(/^\/api/, "") || "/",
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
  /** Named tunnel hostname (e.g. `local-4444.veritly.co.uk`). Without HMR `wss`+443, the dev client tries `ws://localhost:<port>` from an `https://` page → mixed-content blocked. Bun servers on other ports do not inject `@vite/client`. */
  const tunnelPublicHost = env.VERITLY_TUNNEL_PUBLIC_HOST?.trim()

  return {
    plugins: [desktopPlugin] as any,
    server: {
      /** `true` listens on all interfaces (v4 + v6); `0.0.0.0` is IPv4-only and can break `localhost`→`::1` clients (e.g. cloudflared). */
      host: true,
      /** Tunnel hostnames send `Host: local-*.veritly.co.uk`; without this Vite returns 403 (OpenCode/sdk-relay on other ports do not run this check). */
      allowedHosts: [".veritly.co.uk"],
      ...(tunnelPublicHost
        ? {
            origin: `https://${tunnelPublicHost}`,
            hmr: {
              protocol: "wss",
              host: tunnelPublicHost,
              clientPort: 443,
            },
          }
        : {}),
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
