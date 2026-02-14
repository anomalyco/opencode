import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite"
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
 * Cloud-specific Vite configuration for Claxedo.
 */
function cloudConfig({ mode }: { mode: string }): UserConfig {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const terminalBackend = env.VITE_TERMINAL_BACKEND || "xterm"
  return {
    plugins: [overrideResolver(), solidPlugin(), tailwindcss()],
    publicDir: "public",
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 4444,
    },
    worker: {
      format: "es",
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
