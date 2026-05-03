import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"
import type { Plugin } from "vite"
import {
  frontendHealthReport,
} from "./script/frontend-health-runtime"
import desktopPlugin from "./vite"

const appPackageRoot = fileURLToPath(new URL(".", import.meta.url))

function veritlyDevHealthPlugin(procEnv: NodeJS.ProcessEnv): Plugin {
  const attach = (server: { middlewares: import("connect").Server }) => {
    server.middlewares.use((req, res, next) => {
        if (req.method !== "GET") {
          next()
          return
        }
        const pathname = req.url?.split("?")[0] ?? ""
        const probe = new Set(["/livez", "/readyz"])
        if (!probe.has(pathname)) {
          next()
          return
        }
        void (async () => {
          try {
            if (pathname === "/livez") {
              res.statusCode = 200
              res.setHeader("content-type", "text/plain; charset=utf-8")
              res.end("ok")
              return
            }
            if (pathname === "/readyz") {
              const report = await frontendHealthReport(appPackageRoot, procEnv)
              res.statusCode = report.ok ? 200 : 503
              res.setHeader("content-type", "application/json; charset=utf-8")
              res.end(JSON.stringify(report))
              return
            }
          } catch (err) {
            next(err instanceof Error ? err : new Error(String(err)))
          }
        })()
      })
  }
  return {
    name: "veritly-dev-health",
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

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
      /** Match `serve-custom-app.mjs`: public `/api/*` → OpenCode root (`/global/readyz`, `/univer-sdk-relay/…`). */
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
  const root = fileURLToPath(new URL("../..", import.meta.url))
  const env = loadEnv(mode, root, "")
  const mergedEnv = { ...process.env, ...env } as NodeJS.ProcessEnv
  const axiomHost = (env.VITE_PUBLIC_AXIOM_URL || "https://api.axiom.co").replace(/\/+$/, "")
  /** Forward `/api/*` (HTTP + WebSocket) to hosted edge so `VITE_UNIVER_SDK_WS=/api/...` is same-origin in dev. */
  const devProxyTarget = env.DEV_PROXY_TARGET?.trim()
  /** Named tunnel hostname (e.g. `local-4444.veritly.co.uk`). Without HMR `wss`+443, the dev client tries `ws://localhost:<port>` from an `https://` page → mixed-content blocked. Bun servers on other ports do not inject `@vite/client`. */
  const tunnelPublicHost = env.VERITLY_TUNNEL_PUBLIC_HOST?.trim()

  return {
    envDir: root,
    plugins: [veritlyDevHealthPlugin(mergedEnv), desktopPlugin] as any,
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
    optimizeDeps: {
      exclude: ["pyodide"],
    },
  }
})
