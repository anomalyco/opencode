import { randomBytes } from "crypto"
import { isIP } from "net"
import { networkInterfaces } from "os"

const status_timeout = 5_000
const serve_timeout = 15_000
const https_port = 443

type Status = {
  BackendState?: string
  Self?: {
    DNSName?: string
  }
}

type Result = {
  code: number
  out: string
  err: string
  timed: boolean
}

function clean(input?: string) {
  const value = input?.trim().toLowerCase() ?? ""
  if (!value) return ""
  if (value === "localhost") return "127.0.0.1"
  if (value.startsWith("::ffff:")) return value.slice(7)
  return value
}

function loopback(input?: string) {
  const value = clean(input)
  if (!value) return false
  return value === "::1" || value === "127.0.0.1" || value.startsWith("127.")
}

function private4(input?: string) {
  const value = clean(input)
  if (isIP(value) !== 4) return false
  if (value.startsWith("10.")) return true
  if (value.startsWith("192.168.")) return true
  return /^172\.(1[6-9]|2\d|3[01])\./.test(value)
}

function private6(input?: string) {
  const value = clean(input)
  if (isIP(value) !== 6) return false
  return value.startsWith("fc") || value.startsWith("fd")
}

function lan(input?: string) {
  return private4(input) || private6(input)
}

function rank(input: string) {
  if (input.startsWith("192.168.")) return 0
  if (input.startsWith("10.")) return 1
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(input)) return 2
  return 100
}

function host(input: string) {
  return input.includes(":") && !input.startsWith("[") ? `[${input}]` : input
}

async function run(args: string[], timeout: number) {
  const bin = Bun.which("tailscale")
  if (!bin) {
    throw new Error(
      "tailscale is required for tailnet mode but was not found in PATH; install Tailscale and connect this machine to your tailnet first",
    )
  }

  const ctl = new AbortController()
  let timed = false
  const timer = setTimeout(() => {
    timed = true
    ctl.abort()
  }, timeout)

  const child = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal: ctl.signal,
  })

  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  clearTimeout(timer)

  return {
    code,
    out: out.trim(),
    err: err.trim(),
    timed,
  } satisfies Result
}

function format(result: Result) {
  const text = [result.out, result.err].filter(Boolean).join("\n").trim()
  if (result.timed) return text ? `timed out; ${text}` : "timed out"
  if (result.code === 0) return text
  return text || `exit code ${result.code}`
}

async function status() {
  const result = await run(["status", "--json"], status_timeout)
  if (result.code !== 0 || result.timed) {
    throw new Error(`query tailscale status: ${format(result)}`)
  }
  return JSON.parse(result.out) as Status
}

export namespace RemoteAccess {
  export type Mode = "lan" | "tailnet"

  export type Tunnel = {
    url: string
    stop: () => Promise<void>
  }

  export function normalize(input?: string): Mode {
    return input === "tailnet" ? "tailnet" : "lan"
  }

  export function allows(mode: Mode, input?: string) {
    if (mode === "tailnet") return loopback(input)
    return loopback(input) || lan(input)
  }

  export function resolveHost(mode: Mode, input?: string) {
    const value = clean(input)
    if (mode === "tailnet") {
      if (!value) return "127.0.0.1"
      if (!loopback(value)) {
        throw new Error(`remote host ${JSON.stringify(input)} must be a loopback IP in tailnet mode`)
      }
      return value
    }

    if (value) {
      if (!private4(value) || loopback(value)) {
        throw new Error(`remote host ${JSON.stringify(input)} must be a private LAN IP (not loopback or public)`)
      }
      return value
    }

    const list = Object.values(networkInterfaces())
      .flatMap((item) => item ?? [])
      .filter((item) => item.family === "IPv4" && !item.internal)
      .map((item) => item.address)
      .filter((item) => private4(item) && !loopback(item))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

    if (list[0]) return list[0]
    throw new Error("no private LAN IPv4 address found")
  }

  export function origin(input: { hostname: string; port: number }) {
    return `http://${host(input.hostname)}:${input.port}`
  }

  export async function start(input: { hostname: string; port: number }) {
    const info = await status()
    const state = info.BackendState?.trim()
    if (state && state.toLowerCase() !== "running") {
      throw new Error(`tailscale is not connected (backend state ${state}); run \`tailscale up\` first`)
    }

    const dns = info.Self?.DNSName?.trim().replace(/\.$/, "")
    if (!dns) {
      throw new Error(
        "tailscale status did not include this device's tailnet DNS name; make sure this machine is logged in to a tailnet",
      )
    }

    const path = `/opencode-remote-${randomBytes(4).toString("hex")}`
    const result = await run(
      ["serve", "--bg", "--yes", `--https=${https_port}`, `--set-path=${path}`, origin(input)],
      serve_timeout,
    )
    if (result.code !== 0 || result.timed) {
      const detail = format(result)
      throw new Error(`configure tailscale serve: ${detail}`)
    }

    return {
      url: `https://${dns}${path}/`,
      stop: async () => {
        const result = await run(
          ["serve", "--yes", `--https=${https_port}`, `--set-path=${path}`, "off"],
          status_timeout,
        )
        if (result.code !== 0 || result.timed) {
          throw new Error(`disable tailscale serve: ${format(result)}`)
        }
      },
    } satisfies Tunnel
  }
}
