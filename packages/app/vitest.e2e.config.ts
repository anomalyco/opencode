import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(appDir, "..", "..")

/** `.env.e2e` is not a Vite mode file; merge KEY=value lines without overriding the shell. */
function mergeEnvFile(file: string) {
  if (!existsSync(file)) return
  const raw = readFileSync(file, "utf8")
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    const q0 = val[0]
    const q1 = val[val.length - 1]
    if (val.length >= 2 && (q0 === '"' || q0 === "'") && q0 === q1) val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function wireE2eEnv() {
  for (const [k, v] of Object.entries(loadEnv("development", repoDir, ""))) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  for (const [k, v] of Object.entries(loadEnv("development", appDir, ""))) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  mergeEnvFile(path.join(appDir, ".env.e2e"))
}

wireE2eEnv()

export default defineConfig({
  test: {
    include: ["test/browser/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 420_000,
    pool: "forks",
    maxForks: 1,
  },
})
