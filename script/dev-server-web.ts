#!/usr/bin/env bun

import net from "node:net"

function split(args: string[]) {
  const out = {
    server: [] as string[],
    web: [] as string[],
  }
  let mode: "server" | "web" | undefined

  for (const arg of args) {
    if (arg === "--server") {
      mode = "server"
      continue
    }
    if (arg === "--web") {
      mode = "web"
      continue
    }
    if (!mode) {
      throw new Error(`Unknown argument ${arg}. Pass backend args after --server and app args after --web.`)
    }
    out[mode].push(arg)
  }

  return out
}

function val(args: string[], key: string) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === key) return args[i + 1]
    if (args[i].startsWith(`${key}=`)) return args[i].slice(key.length + 1)
  }
}

function num(args: string[], key: string) {
  const raw = val(args, key)
  if (!raw) return
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid value for ${key}: ${raw}`)
  }
  return n
}

function local(host?: string) {
  if (!host || host === "0.0.0.0" || host === "::") return "127.0.0.1"
  return host
}

function openHost(host?: string) {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost"
  return host
}

async function free() {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      srv.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(addr.port)
      })
    })
  })
}

async function wait(url: string, name: string) {
  const end = Date.now() + 120_000
  let last = ""
  while (Date.now() < end) {
    const result = await fetch(url)
      .then((res) => ({ ok: res.ok, err: "" }))
      .catch((err) => ({ ok: false, err: err instanceof Error ? err.message : String(err) }))
    if (result.ok) return
    last = result.err || last
    await Bun.sleep(250)
  }
  throw new Error(`Timed out waiting for ${name}${last ? ` (${last})` : ""}`)
}

async function browser(url: string) {
  if (process.platform === "darwin") {
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" })
    return
  }
  if (process.platform === "linux") {
    Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" })
    return
  }
  if (process.platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", "", url], { stdout: "ignore", stderr: "ignore" })
  }
}

const args = split(process.argv.slice(2))
const serverPort = (num(args.server, "--port") ?? Number(process.env.SERVER_PORT)) || (await free())
const webPort = (num(args.web, "--port") ?? Number(process.env.WEB_PORT)) || (await free())
const serverHost = local(val(args.server, "--hostname") ?? process.env.SERVER_HOST)
const webHost = openHost(val(args.web, "--host") ?? process.env.WEB_HOST)

const serverCmd = [
  "bun",
  "run",
  "--cwd",
  "packages/opencode",
  "--conditions=browser",
  "src/index.ts",
  "serve",
  ...args.server,
]
if (!num(args.server, "--port")) serverCmd.push("--port", String(serverPort))

const webCmd = ["bun", "run", "--cwd", "packages/app", "dev", "--", ...args.web]
if (!num(args.web, "--port")) webCmd.push("--port", String(webPort))

const serverUrl = `http://${serverHost}:${serverPort}`
const webUrl = `http://${webHost}:${webPort}`
const serverEnv = {
  ...process.env,
  OPENCODE_SERVER_PASSWORD: "",
  OPENCODE_SERVER_USERNAME: "",
}

console.log(`Starting backend at ${serverUrl}`)
const server = Bun.spawn(serverCmd, {
  env: serverEnv,
  stdout: "inherit",
  stderr: "inherit",
})

let web: Bun.Subprocess | undefined
let done = false

const stop = () => {
  if (done) return
  done = true
  if (web && web.exitCode === null) web.kill("SIGTERM")
  if (server.exitCode === null) server.kill("SIGTERM")
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(sig, () => {
    stop()
  })
}

await wait(`${serverUrl}/global/health`, `server health at ${serverUrl}/global/health`)

console.log(`Starting app at ${webUrl}`)
web = Bun.spawn(webCmd, {
  env: {
    ...process.env,
    VITE_OPENCODE_SERVER_HOST: serverHost,
    VITE_OPENCODE_SERVER_PORT: String(serverPort),
  },
  stdout: "inherit",
  stderr: "inherit",
})

await wait(webUrl, `web app at ${webUrl}`)
console.log(`Backend ready: ${serverUrl}`)
console.log(`App ready: ${webUrl}`)
await browser(webUrl)

const result = await Promise.race([
  server.exited.then((code) => ({ name: "server", code })),
  web.exited.then((code) => ({ name: "web", code })),
])

if (!done) {
  stop()
  if (result.code !== 0) {
    console.error(`${result.name} exited with code ${result.code}`)
    process.exit(result.code || 1)
  }
}
