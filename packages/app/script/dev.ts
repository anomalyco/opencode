import path from "node:path"

const dir = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const host = process.env.DEV_FRONTEND_HOST?.trim() || "127.0.0.1"
const port = process.env.DEV_FRONTEND_PORT?.trim() || "4444"
const backHost = process.env.VITE_OPENCODE_SERVER_HOST?.trim() || process.env.DEV_BACKEND_HOST?.trim() || "127.0.0.1"
const backPort = process.env.VITE_OPENCODE_SERVER_PORT?.trim() || process.env.DEV_BACKEND_PORT?.trim() || "4096"
const backUrl = process.env.VITE_OPENCODE_SERVER_URL?.trim() || `http://${backHost}:${backPort}`

const cmd = ["bun", "x", "vite"]
if (!has("--host")) cmd.push("--host", host)
if (!has("--port")) cmd.push("--port", port)
cmd.push(...args)

const child = Bun.spawn({
  cmd,
  cwd: dir,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    VITE_OPENCODE_SERVER_HOST: backHost,
    VITE_OPENCODE_SERVER_PORT: backPort,
    VITE_OPENCODE_SERVER_URL: backUrl,
  },
})

process.exit(await child.exited)
