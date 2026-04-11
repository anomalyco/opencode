import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import os from "node:os"
import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { PushRelay } from "../../server/push-relay"
import { Log } from "../../util/log"
import * as QRCode from "qrcode"

const log = Log.create({ service: "serve" })

type PairPayload = {
  v: 1
  serverID?: string
  relayURL: string
  relaySecret: string
  hosts: string[]
}

type TailscaleStatus = {
  Self?: {
    DNSName?: unknown
    TailscaleIPs?: unknown
  }
}

function ipTier(address: string): number {
  const parts = address.split(".")
  if (parts.length !== 4) return 4
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (a === 127) return 4
  if (a === 169 && b === 254) return 3
  if (a === 10) return 2
  if (a === 172 && b >= 16 && b <= 31) return 2
  if (a === 192 && b === 168) return 2
  if (a === 100 && b >= 64 && b <= 127) return 1
  return 0
}

function norm(input: string) {
  return input.replace(/\/+$/, "")
}

function advertiseURL(input: string, port: number): string | undefined {
  const raw = input.trim()
  if (!raw) return

  try {
    const hasScheme = raw.includes("://")
    const parsed = new URL(hasScheme ? raw : `http://${raw}`)
    if (!parsed.hostname) return
    if (!parsed.port && !hasScheme) {
      parsed.port = String(port)
    }
    return norm(`${parsed.protocol}//${parsed.host}`)
  } catch {
    return
  }
}

function hosts(hostname: string, port: number, advertised: string[] = [], includeLocal = true) {
  const seen = new Set<string>()
  const preferred: string[] = []
  const entries: Array<{ url: string; tier: number }> = []

  const addPreferred = (value: string) => {
    const url = advertiseURL(value, port)
    if (!url) return
    if (seen.has(url)) return
    seen.add(url)
    preferred.push(url)
  }

  const add = (item: string) => {
    if (!item) return
    if (item === "0.0.0.0") return
    if (item === "::") return
    const url = `http://${item}:${port}`
    if (seen.has(url)) return
    seen.add(url)
    entries.push({ url, tier: ipTier(item) })
  }

  advertised.forEach(addPreferred)

  if (includeLocal) {
    add(hostname)
    Object.values(os.networkInterfaces())
      .flatMap((item) => item ?? [])
      .filter((item) => item.family === "IPv4" && !item.internal)
      .map((item) => item.address)
      .forEach(add)
  }

  entries.sort((a, b) => a.tier - b.tier)
  return [...preferred, ...entries.map((item) => item.url)]
}

function pairLink(pair: unknown) {
  return `mobilevoice:///?pair=${encodeURIComponent(JSON.stringify(pair))}`
}

function pairServerID(input: { relayURL: string; relaySecret: string }) {
  return createHash("sha256").update(`${input.relayURL}|${input.relaySecret}`).digest("hex").slice(0, 16)
}

function secretHash(input: string) {
  if (!input) return "none"
  return `${createHash("sha256").update(input).digest("hex").slice(0, 12)}...`
}

export function autoTailscaleAdvertiseHost(hostname: string, status: unknown): string | undefined {
  const self = (status as TailscaleStatus | undefined)?.Self
  if (!self) return

  const dnsName = typeof self.DNSName === "string" ? self.DNSName.replace(/\.+$/, "") : ""
  if (!dnsName || !dnsName.toLowerCase().endsWith(".ts.net")) return

  if (hostname === "0.0.0.0" || hostname === "::" || hostname === dnsName) {
    return dnsName
  }

  const tailscaleIPs = Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  if (tailscaleIPs.includes(hostname)) {
    return dnsName
  }
}

function readTailscaleAdvertiseHost(hostname: string) {
  try {
    const result = spawnSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (result.status !== 0 || result.error || !result.stdout.trim()) return
    return autoTailscaleAdvertiseHost(hostname, JSON.parse(result.stdout))
  } catch {
    return
  }
}

async function printPairQR(pair: PairPayload) {
  const link = pairLink(pair)
  const qrConfig = {
    type: "terminal" as const,
    small: true,
    errorCorrectionLevel: "M" as const,
  }
  log.info("pair qr", {
    relayURL: pair.relayURL,
    relaySecretHash: secretHash(pair.relaySecret),
    serverID: pair.serverID,
    hosts: pair.hosts,
    hostCount: pair.hosts.length,
    hasLoopbackHost: pair.hosts.some((item) => item.includes("127.0.0.1") || item.includes("localhost")),
    linkLength: link.length,
    qr: qrConfig,
  })
  const code = await QRCode.toString(link, {
    ...qrConfig,
  })
  console.log("scan qr code in mobile app or phone camera (latest 1.0.2.1)")
  console.log(code)
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("relay-url", {
        type: "string",
        describe: "experimental APN relay URL",
      })
      .option("relay-secret", {
        type: "string",
        describe: "experimental APN relay secret",
      })
      .option("advertise-host", {
        type: "string",
        array: true,
        describe: "preferred host/domain for mobile QR (repeatable, supports host[:port] or URL)",
      })
      .option("connect-qr", {
        type: "boolean",
        default: false,
        describe: "print mobile connect QR and exit without starting the server",
      }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const relayURL = (
      args["relay-url"] ??
      process.env.OPENCODE_EXPERIMENTAL_PUSH_RELAY_URL ??
      "https://apn.dev.opencode.ai"
    ).trim()
    const advertiseHostArg = args["advertise-host"]
    const advertiseHostsFromArg = Array.isArray(advertiseHostArg)
      ? advertiseHostArg
      : typeof advertiseHostArg === "string"
        ? [advertiseHostArg]
        : []
    const advertiseHostsFromEnv = (process.env.OPENCODE_EXPERIMENTAL_PUSH_ADVERTISE_HOSTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    const tailscaleAdvertiseHost = readTailscaleAdvertiseHost(opts.hostname)
    const advertiseHosts = [
      ...new Set([
        ...advertiseHostsFromArg,
        ...advertiseHostsFromEnv,
        ...(tailscaleAdvertiseHost ? [tailscaleAdvertiseHost] : []),
      ]),
    ]

    const input = (args["relay-secret"] ?? process.env.OPENCODE_EXPERIMENTAL_PUSH_RELAY_SECRET ?? "").trim()
    const relaySecret = input || randomBytes(18).toString("base64url")
    const connectQR = Boolean(args["connect-qr"])

    if (connectQR) {
      const pairHosts = hosts(opts.hostname, opts.port > 0 ? opts.port : 4096, advertiseHosts, false)
      if (!pairHosts.length) {
        console.log("connect qr mode requires at least one valid advertised host")
        return
      }

      if (!input) {
        console.log("experimental push relay secret generated")
        console.log(
          "set --relay-secret or OPENCODE_EXPERIMENTAL_PUSH_RELAY_SECRET to keep push registrations stable across server restarts",
        )
      }

      console.log("printing connect qr without starting the server")
      await printPairQR({
        v: 1,
        serverID: pairServerID({ relayURL, relaySecret }),
        relayURL,
        relaySecret,
        hosts: pairHosts,
      })
      return
    }

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }

    const server = await Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    if (!input) {
      console.log("experimental push relay secret generated")
      console.log(
        "set --relay-secret or OPENCODE_EXPERIMENTAL_PUSH_RELAY_SECRET to keep push registrations stable across server restarts",
      )
    }
    if (relayURL && relaySecret) {
      const host = server.hostname ?? opts.hostname
      const port = server.port || opts.port || 4096
      const started = PushRelay.start({
        relayURL,
        relaySecret,
        hostname: host,
        port,
        advertiseHosts,
      })
      const pair = started ??
        PushRelay.pair() ?? {
          v: 1 as const,
          serverID: pairServerID({ relayURL, relaySecret }),
          relayURL,
          relaySecret,
          hosts: hosts(host, port, advertiseHosts),
        }
      if (!started) {
        console.log("experimental push relay failed to initialize; showing setup qr anyway")
      }
      if (pair) {
        console.log("experimental push relay enabled")
        await printPairQR(pair)
      }
    }

    await new Promise(() => {})
    await server.stop()
  },
})
