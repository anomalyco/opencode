import { defineConfig, loadEnv, mergeConfig, type Plugin, type UserConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { readdirSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

function list(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return list(p)
    return [p]
  })
}

function overrides() {
  const root = fileURLToPath(new URL("./src/overrides/", import.meta.url))
  const files = list(root).filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))

  return files.map((p) => {
    const rel = path.relative(root, p).replace(/\\/g, "/")
    const key = `@/${rel.replace(/\.(ts|tsx)$/, "")}`
    // Use exact-match regex so that e.g. "@/pages/layout" does NOT
    // prefix-match "@/pages/layout/helpers" (which lives in upstream).
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return { find: new RegExp(`^${escaped}$`), replacement: p }
  })
}

const enabled = process.env.CLAXEDO_OVERRIDES !== "0"

const overridesRoot = fileURLToPath(new URL("./src/overrides/", import.meta.url))
const upstreamRoot = fileURLToPath(new URL("../app/src/", import.meta.url))

/**
 * Vite plugin that intercepts relative imports from upstream files and
 * redirects them to claxedo overrides when one exists.
 *
 * Without this, upstream `./global-sync` resolves to the upstream file even
 * when an override exists, forcing us to maintain import-only override copies
 * of every file that references an overridden sibling.
 */
function overrideResolver(): Plugin {
  const overrideMap = new Map<string, string>()
  if (enabled) {
    const files = list(overridesRoot).filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    for (const f of files) {
      const rel = path.relative(overridesRoot, f).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "")
      overrideMap.set(rel, f)
    }
  }

  return {
    name: "claxedo-override-resolver",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (overrideMap.size === 0) return null
      if (!importer?.startsWith(upstreamRoot)) return null
      if (!source.startsWith("./") && !source.startsWith("../")) return null

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      if (!resolved.id.startsWith(upstreamRoot)) return null

      const key = path
        .relative(upstreamRoot, resolved.id)
        .replace(/\\/g, "/")
        .replace(/\.(ts|tsx)$/, "")

      return overrideMap.get(key) ?? null
    },
  }
}

/**
 * Convert Convex cloud URL to site URL for HTTP actions.
 */
function toConvexSiteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(".convex.cloud", ".convex.site")
}

/**
 * Cloud-specific Vite configuration for Claxedo.
 *
 * This config adds proxy rules for:
 * - Auth endpoints (Convex Better Auth)
 * - Workspace API (cloud workspace management)
 * - Sandbox API (legacy; compatibility)
 * - Workspace gateway (WebSocket proxying to sandboxes)
 * - Session gateway (legacy; compatibility)
 * - OpenCode backend API
 */
function cloudConfig({ mode }: { mode: string }): UserConfig {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const terminalBackend = env.VITE_TERMINAL_BACKEND || "xterm"
  const convexSiteUrl =
    toConvexSiteUrl(env.VITE_CONVEX_SITE_URL) ?? toConvexSiteUrl(env.VITE_CONVEX_URL)
  const gatewayUrl = (env.VITE_OPENCODE_BACKEND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "")
  console.log(`[vite cloud] gatewayUrl = ${gatewayUrl}`)
  console.log(`[vite cloud] VITE_OPENCODE_BACKEND_URL = ${env.VITE_OPENCODE_BACKEND_URL}`)
  const DEBUG_PROXY = env.VITE_DEBUG_PROXY === "true"

  const logProxyError = (label: string) => (err: any, req: any) => {
    console.error(`[vite proxy] ${label} ERROR`, req?.method, req?.url, err?.message || err)
  }

  const attachWsDebug = (label: string) => (proxy: any) => {
    if (!DEBUG_PROXY) return
    proxy.on("proxyReqWs", (_proxyReq: any, req: any) => {
      console.log(`[vite proxy] ${label} WS`, req?.method, req?.url)
    })
    proxy.on("open", () => {
      console.log(`[vite proxy] ${label} WS open`)
    })
    proxy.on("close", () => {
      console.log(`[vite proxy] ${label} WS close`)
    })
  }

  return {
    plugins: [overrideResolver(), solidPlugin(), tailwindcss()],
    publicDir: "../app/public",
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 4444,
      proxy: {
        // Vite's proxy config keys are treated as path prefixes (not regex strings).
        // Use explicit prefixes so API fetches never fall through to the SPA HTML.
        ...Object.fromEntries([
          ...[
            "agent",
            "auth",
            "command",
            "config",
            "event",
            "experimental",
            "file",
            "find",
            "formatter",
            "global",
            "hook",
            "instance",
            "lsp",
            "mcp",
            "path",
            "permission",
            "project",
            "provider",
            // "pty", // Separate config below
            "question",
            "session",
            "skill",
            "tui",
            "tunnel",
            "vcs",
          ].map((p) => [
            `/${p}`,
            {
              target: gatewayUrl,
              changeOrigin: true,
              secure: false,
              ws: true,
              configure: (proxy: any) => {
                proxy.on("error", logProxyError(`/${p} -> ${gatewayUrl}`))
                attachWsDebug(`/${p} -> ${gatewayUrl}`)(proxy)
              },
            },
          ]),
          [
            "/pty",
            {
              target: gatewayUrl,
              changeOrigin: false,
              secure: false,
              ws: true,
              configure: (proxy: any) => {
                proxy.on("error", logProxyError(`/pty -> ${gatewayUrl}`))
                attachWsDebug(`/pty -> ${gatewayUrl}`)(proxy)
              },
            }
          ]
        ]),
        "^/log(?:$|\\?|/)": {
          target: gatewayUrl,
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy: any) => {
            proxy.on("error", logProxyError(`/log -> ${gatewayUrl}`))
            attachWsDebug(`/log -> ${gatewayUrl}`)(proxy)
          },
        },

        // Auth proxy to Convex site URL (Better Auth HTTP actions)
        ...(convexSiteUrl
          ? {
              "/api/auth": {
                target: convexSiteUrl,
                changeOrigin: true,
                secure: false,
                configure: (proxy) => {
                  proxy.on("error", logProxyError(`/api/auth -> ${convexSiteUrl}`))
                  proxy.on("proxyRes", (proxyRes: any, req: any) => {
                    const status = proxyRes?.statusCode
                    if (typeof status === "number" && status >= 400) {
                      console.error(
                        `[vite proxy] /api/auth -> ${convexSiteUrl} ${status}`,
                        req?.method,
                        req?.url
                      )
                    }
                  })
                },
              },
            }
          : {}),

        // Sandbox API proxy (cloud project creation/management)
        // Workspace API proxy (cloud workspace creation/management)
        "/api/workspace": {
          target: gatewayUrl,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => proxy.on("error", logProxyError(`/api/workspace -> ${gatewayUrl}`)),
        },
        "/api/experimental": {
          target: gatewayUrl,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => proxy.on("error", logProxyError(`/api/api/experimental -> ${gatewayUrl}`)),
        },

        // Sandbox agent management API (spawn/stop/status)
        "/api/sandbox-agent": {
          target: gatewayUrl,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => proxy.on("error", logProxyError(`/api/sandbox-agent -> ${gatewayUrl}`)),
        },

        // Workspace gateway proxy (HTTP + WebSocket)
        // IMPORTANT: use `/w/` (not `/w`) so we don't accidentally proxy Vite module URLs like `/src/*`.
        "/w/": {
          target: gatewayUrl,
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", logProxyError(`/w/ -> ${gatewayUrl}`))
            attachWsDebug(`/w/ -> ${gatewayUrl}`)(proxy)
          },
        },
      },
    },
    build: {
      target: "esnext",
      outDir: "dist",
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-solid': ['solid-js', 'solid-js/web', 'solid-js/store'],
            'vendor-dnd': ['@thisbeyond/solid-dnd'],
            'vendor-clerk': ['@clerk/clerk-js'],
          },
        },
      },
    },
    resolve: {
      alias: [
        // Terminal backend swap (build-time, zero runtime overhead)
        {
          find: "#terminal-backend",
          replacement: new URL(
            `./src/overrides/terminal/backend/${terminalBackend}.ts`,
            import.meta.url,
          ).pathname,
        },
        // Override files (specific aliases take precedence)
        ...(enabled ? overrides() : []),
        // Resolve claxedo-specific paths
        { find: "@claxedo/", replacement: new URL("./src/", import.meta.url).pathname },
        // General @/ alias (lowest priority)
        { find: "@/", replacement: new URL("../app/src/", import.meta.url).pathname },
      ],
    },
  }
}

export default defineConfig(({ mode }) => cloudConfig({ mode }))
