import path from "node:path"

const dir = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const host = process.env.DEV_FRONTEND_HOST?.trim()
const port = process.env.DEV_FRONTEND_PORT?.trim()
if (!host) throw new Error("Missing DEV_FRONTEND_HOST")
if (!port) throw new Error("Missing DEV_FRONTEND_PORT")
const backHost = process.env.VITE_OPENCODE_SERVER_HOST?.trim() || process.env.DEV_BACKEND_HOST?.trim()
const backPort = process.env.VITE_OPENCODE_SERVER_PORT?.trim() || process.env.DEV_BACKEND_PORT?.trim()
const backUrl = process.env.VITE_OPENCODE_SERVER_URL?.trim()
if (!backHost) throw new Error("Missing DEV_BACKEND_HOST")
if (!backPort) throw new Error("Missing DEV_BACKEND_PORT")

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
