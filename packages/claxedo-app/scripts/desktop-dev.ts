import { file } from "bun"

// Load .env.local if it exists
const envLocalPath = new URL("../.env.local", import.meta.url).pathname
try {
  const envContent = await file(envLocalPath).text()
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const [key, ...rest] = trimmed.split("=")
    if (key && rest.length > 0) {
      const value = rest.join("=")
      if (!Bun.env[key]) {
        Bun.env[key] = value
      }
    }
  }
} catch {
  // .env.local doesn't exist, that's fine
}

// Get the Claxedo backend URL (defaults to http://127.0.0.1:3000)
const claxedoBackendUrl = Bun.env.VITE_OPENCODE_BACKEND_URL ?? "http://127.0.0.1:3000"

// eslint-disable-next-line no-console
console.log(`[claxedo] Using Claxedo backend: ${claxedoBackendUrl}`)

const base = Number(Bun.env.OPENCODE_DESKTOP_PORT ?? "1420")

const pick = (start: number) => {
  for (const port of Array.from({ length: 25 }, (_, i) => start + i)) {
    const ok = (() => {
      try {
        const server = Bun.serve({
          port,
          fetch() {
            return new Response("ok")
          },
        })
        server.stop(true)
        return true
      } catch {
        return false
      }
    })()

    if (ok) return port
  }
}

const port = pick(base)
if (!port) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] No free port found in range ${base}-${base + 24} for desktop dev server.`)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[claxedo] Desktop dev server port: ${port}`)

// Start Vite with claxedo cloud config
// eslint-disable-next-line no-console
console.log(`[claxedo] Starting Vite with cloud config...`)

const viteProc = Bun.spawn({
  cmd: ["bun", "run", "vite", "--config", "vite.cloud.config.ts", "--port", String(port)],
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...Bun.env,
    CLAXEDO_OVERRIDES: "1",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

// Wait for Vite to be ready
const waitForVite = async (url: string, maxAttempts = 60) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

const viteReady = await waitForVite(`http://127.0.0.1:${port}`)
if (!viteReady) {
  // eslint-disable-next-line no-console
  console.error(`[claxedo] Vite server failed to start at http://127.0.0.1:${port}`)
  viteProc.kill()
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[claxedo] Vite ready at http://127.0.0.1:${port}`)

// Tauri config to use our Vite server and skip its own beforeDevCommand
const config = JSON.stringify({
  build: {
    devUrl: `http://127.0.0.1:${port}`,
    beforeDevCommand: "", // Skip Tauri's default dev command
  },
})

const tauriProc = Bun.spawn({
  cmd: ["bun", "run", "--cwd", "../desktop", "tauri", "--", "dev", "--config", config],
  env: {
    ...Bun.env,
    OPENCODE_DESKTOP_PORT: String(port),
    TAURI_DEV_HOST: "127.0.0.1",
    CLAXEDO_BACKEND_URL: claxedoBackendUrl,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

// Handle cleanup
const cleanup = () => {
  viteProc.kill()
  tauriProc.kill()
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

// Wait for Tauri to exit
const exitCode = await tauriProc.exited
cleanup()
process.exit(exitCode)
