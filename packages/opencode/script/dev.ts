import path from "node:path"

const dir = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const host = process.env.DEV_BACKEND_HOST?.trim() || "127.0.0.1"
const port = process.env.DEV_BACKEND_PORT?.trim() || "4096"
const frontHost = process.env.DEV_FRONTEND_HOST?.trim() || "127.0.0.1"
const frontPort = process.env.DEV_FRONTEND_PORT?.trim() || "4444"
const base = process.env.PUBLIC_BASE_URL?.trim() || `http://${frontHost}:${frontPort}`
const redirect = process.env.WORKOS_REDIRECT_URI?.trim() || `http://${host}:${port}/auth/callback`

const cmd = ["bun", "run", "./src/server/main.ts"]
if (!has("--hostname")) cmd.push("--hostname", host)
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
    PUBLIC_BASE_URL: base,
    WORKOS_REDIRECT_URI: redirect,
  },
})

process.exit(await child.exited)
