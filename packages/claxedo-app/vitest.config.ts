import { defineConfig } from "vitest/config"
import solid from "vite-plugin-solid"
import path from "path"
import { fileURLToPath } from "url"
import { readdirSync } from "fs"

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
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return { find: new RegExp(`^${escaped}$`), replacement: normalizePath(p) }
  })
}

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["development", "browser"],
    alias: [
      {
        find: "#terminal-backend",
        replacement: normalizePath(fileURLToPath(new URL("./src/overrides/terminal/backend/xterm.ts", import.meta.url))),
      },
      ...overrides(),
      { find: "@claxedo/", replacement: normalizePath(fileURLToPath(new URL("./src/", import.meta.url))) },
      { find: "@/", replacement: normalizePath(fileURLToPath(new URL("../app/src/", import.meta.url))) },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.vitest.ts", "src/**/*.vitest.tsx"],
  },
})
