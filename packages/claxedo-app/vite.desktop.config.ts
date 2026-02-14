import { defineConfig, loadEnv, type Plugin } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { readdirSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const normalizePath = (p: string) => p.replace(/\\/g, "/")

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
    // prefix-match "@/pages/layout/deep-links" (which lives in upstream).
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return { find: new RegExp(`^${escaped}$`), replacement: normalizePath(p) }
  })
}

const enabled = process.env.CLAXEDO_OVERRIDES !== "0"

const overridesRoot = normalizePath(fileURLToPath(new URL("./src/overrides/", import.meta.url)))
const upstreamRoot = normalizePath(fileURLToPath(new URL("../app/src/", import.meta.url)))

/**
 * Vite plugin that intercepts relative imports from upstream files and
 * redirects them to claxedo overrides when one exists.
 *
 * Without this, upstream `./server` resolves to the upstream file even
 * when an override exists, causing duplicate SolidJS contexts.
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
      if (!importer || !normalizePath(importer).startsWith(upstreamRoot)) return null
      if (!source.startsWith("./") && !source.startsWith("../")) return null

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      const resolvedId = normalizePath(resolved.id)
      if (!resolvedId.startsWith(upstreamRoot)) return null

      const key = resolvedId
        .slice(upstreamRoot.length)
        .replace(/\.(ts|tsx)$/, "")

      return overrideMap.get(key) ?? null
    },
  }
}

const host = process.env.TAURI_DEV_HOST
const raw = Number(process.env.OPENCODE_DESKTOP_PORT ?? "1420")
const port = Number.isFinite(raw) ? raw : 1420
const hmr = host
  ? {
      protocol: "ws",
      host,
      port: port + 1,
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [overrideResolver(), solidPlugin(), tailwindcss()],
  root: "src/desktop",
  publicDir: "../../public",
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  esbuild: {
    // Improves production stack traces
    keepNames: true,
  },
  build: {
    target: "esnext",
    outDir: "../../dist-desktop",
    emptyOutDir: true,
  },
  worker: {
    format: "es",
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    // Default to ipv4 loopback to avoid "localhost" ipv4/ipv6 resolution differences across runtimes.
    host: host ?? "127.0.0.1",
    hmr,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: [
      // Terminal backend swap (build-time, zero runtime overhead)
      {
        find: "#terminal-backend",
        replacement: normalizePath(fileURLToPath(new URL("./src/overrides/terminal/backend/xterm.ts", import.meta.url))),
      },
      // Override files (specific aliases take precedence)
      ...(enabled ? overrides() : []),
      // Resolve claxedo-specific paths
      { find: "@claxedo/", replacement: normalizePath(fileURLToPath(new URL("./src/", import.meta.url))) },
      // General @/ alias (lowest priority)
      { find: "@/", replacement: normalizePath(fileURLToPath(new URL("../app/src/", import.meta.url))) },
    ],
  },
})
