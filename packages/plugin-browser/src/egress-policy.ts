export * as EgressPolicy from "./egress-policy.js"

import { isIP, type Socket } from "node:net"
import type { Browser } from "./rpc.js"

export type AddressClass = "public" | "loopback" | "private" | "metadata" | "reserved"

export type ResolvedAddress = {
  readonly address: string
  readonly family: 4 | 6
}

export type Resolver = (host: string) => Promise<readonly ResolvedAddress[]>

export type PolicyDecision =
  | { readonly allowed: true; readonly addressClass: AddressClass }
  | { readonly allowed: false; readonly reason: string; readonly addressClass: AddressClass }

export class EgressDeniedError extends Error {
  readonly code = "POLICY_DENIED" as const
  constructor(message: string) {
    super(message)
    this.name = "EgressDeniedError"
  }
}

/**
 * Non-HTTP infrastructure and management ports refused on loopback and private targets so a loaded
 * page cannot reach local SSH, mail, SMB, Docker, or Kubernetes control planes.
 */
export const BLOCKED_MANAGEMENT_PORTS: ReadonlySet<number> = new Set([
  22,
  23,
  25,
  111,
  135,
  137,
  138,
  139,
  445,
  2375,
  2376,
  6443,
  10250,
])

const METADATA_HOSTS: ReadonlySet<string> = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.azure.internal",
  "metadata.packet.net",
  "metadata.platformequinix.com",
])

export interface AttachmentPolicyOptions {
  /** Server-owned local ports (such as the OpenCode HTTP API itself) that page traffic must never reach. */
  readonly reservedLocalPorts?: () => ReadonlySet<number>
  /** Explicit server policy permitting non-management private/RFC1918/ULA LAN targets. Default false. */
  readonly allowPrivateLan?: boolean
  /** Custom DNS resolver (tests). Defaults to Node's `dns.lookup(host, { all: true, verbatim: true })`. */
  readonly resolve?: Resolver
}

export type AttachmentPolicy = ReturnType<typeof makePolicy>

export function readAllowPrivateLanEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = env.OPENCODE_BROWSER_ALLOW_PRIVATE_LAN?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

export function makePolicy(options: AttachmentPolicyOptions = {}) {
  const granted = new Map<string, Set<number>>()
  const allowPrivateLan = options.allowPrivateLan ?? readAllowPrivateLanEnv()
  const reservedLocalPorts = options.reservedLocalPorts ?? (() => new Set<number>())

  const isReservedPort = (port: number) => BLOCKED_MANAGEMENT_PORTS.has(port) || reservedLocalPorts().has(port)

  const isGranted = (host: string, port: number) => granted.get(normalizeHost(host))?.has(port) ?? false

  return {
    /**
     * Grants one attachment access to an explicit private preview host/port (and optional HMR ports).
     * Refuses reserved metadata hostnames/IPs and management or server-owned ports.
     */
    grant(host: string, port: number, extraPorts: readonly number[] = []) {
      const normalized = normalizeHost(host)
      if (!normalized || isMetadataHost(normalized)) {
        throw new EgressDeniedError(`Cannot grant reserved metadata host: ${host}`)
      }
      const literal = parseIpLiteral(normalized)
      if (literal) {
        const cls = classifyIp(literal.address)
        if (cls === "metadata" || cls === "reserved") {
          throw new EgressDeniedError(`Cannot grant reserved address: ${host}`)
        }
      }
      const ports = [port, ...extraPorts]
      for (const candidate of ports) {
        if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65_535) {
          throw new EgressDeniedError(`Invalid port in grant: ${candidate}`)
        }
        if (isReservedPort(candidate)) {
          throw new EgressDeniedError(`Cannot grant protected management port ${candidate}.`)
        }
      }
      const existing = granted.get(normalized) ?? new Set<number>()
      ports.forEach((candidate) => existing.add(candidate))
      granted.set(normalized, existing)
    },

    evaluateAddress(host: string, port: number, address: string): PolicyDecision {
      const normalized = normalizeHost(host)
      if (!normalized || isMetadataHost(normalized)) {
        return { allowed: false, addressClass: "metadata", reason: "Access to cloud metadata endpoints is blocked." }
      }
      const cls = classifyIp(address)
      if (cls === "metadata" || cls === "reserved") {
        return {
          allowed: false,
          addressClass: cls,
          reason: `Access to ${cls} address ${address} is blocked by egress policy.`,
        }
      }
      if (cls === "loopback") {
        if (isReservedPort(port)) {
          return {
            allowed: false,
            addressClass: cls,
            reason: `Access to protected local management port ${port} is blocked by egress policy.`,
          }
        }
        if (isLoopbackHostName(normalized) || isGranted(normalized, port)) {
          return { allowed: true, addressClass: cls }
        }
        return {
          allowed: false,
          addressClass: cls,
          reason: `Blocked DNS rebinding: non-loopback host "${normalized}" resolved to loopback address ${address}.`,
        }
      }
      if (cls === "private") {
        if (isReservedPort(port)) {
          return {
            allowed: false,
            addressClass: cls,
            reason: `Access to protected private management port ${port} is blocked by egress policy.`,
          }
        }
        if (allowPrivateLan || isGranted(normalized, port)) {
          return { allowed: true, addressClass: cls }
        }
        return {
          allowed: false,
          addressClass: cls,
          reason: `Access to private network target ${normalized}:${port} (${address}) is blocked by egress policy.`,
        }
      }
      return { allowed: true, addressClass: "public" }
    },

    /**
     * Resolves `target.host` once on the server, validates EVERY resolved address against policy,
     * and returns the complete verified list so the socket can try another address without resolving again.
     */
    async resolveTarget(target: Browser.TunnelTarget): Promise<readonly ResolvedAddress[]> {
      const normalized = normalizeHost(target.host)
      if (!normalized) throw new EgressDeniedError("Target host is empty.")
      if (isMetadataHost(normalized)) {
        throw new EgressDeniedError(`Access to metadata host "${normalized}" is blocked by egress policy.`)
      }
      const literal = parseIpLiteral(normalized)
      const resolved = literal ? [literal] : await (options.resolve ?? defaultResolve)(normalized)
      if (resolved.length === 0) {
        throw new Error(`Could not resolve target host: ${normalized}`)
      }
      // Every resolved address must pass policy so dual-record DNS responses cannot smuggle
      // loopback, private, or metadata addresses behind a public record.
      for (const candidate of resolved) {
        const decision = this.evaluateAddress(normalized, target.port, candidate.address)
        if (!decision.allowed) throw new EgressDeniedError(decision.reason)
      }
      return resolved
    },
  }
}

/**
 * Connects only to verified IPs. The socket selects a reachable address when a host has several.
 */
export async function resolveAndConnect(
  target: Browser.TunnelTarget,
  policy: AttachmentPolicy,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<Socket> {
  if (options.signal?.aborted) throw new Error("Browser tunnel connection was cancelled.")
  const verified = await policy.resolveTarget(target)
  if (options.signal?.aborted) throw new Error("Browser tunnel connection was cancelled.")
  const { createConnection } = await import("node:net")
  const socket = createConnection({
    host: verified.length === 1 ? verified[0].address : target.host,
    autoSelectFamily: true,
    lookup: (_host, options, callback) => {
      if (options.all) return callback(null, [...verified])
      callback(null, verified[0].address, verified[0].family)
    },
    port: target.port,
    allowHalfOpen: true,
  })
  const timeoutMs = options.timeoutMs ?? 10_000
  return await new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      socket.destroy()
      reject(new Error("Browser tunnel target connection timed out."))
    }, timeoutMs)
    const onAbort = () => {
      cleanup()
      socket.destroy()
      reject(new Error("Browser tunnel connection was cancelled."))
    }
    const onConnect = () => {
      cleanup()
      socket.setNoDelay(true)
      resolve(socket)
    }
    const onError = (error: Error) => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("Browser tunnel closed while connecting."))
    }
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      socket.off("connect", onConnect)
      socket.off("error", onError)
      socket.off("close", onClose)
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })
    socket.once("connect", onConnect)
    socket.once("error", onError)
    socket.once("close", onClose)
    if (options.signal?.aborted) onAbort()
  })
}

async function defaultResolve(host: string): Promise<readonly ResolvedAddress[]> {
  const { lookup } = await import("node:dns/promises")
  const results = await lookup(host, { all: true, verbatim: true })
  return results
    .filter((entry): entry is { address: string; family: 4 | 6 } => entry.family === 4 || entry.family === 6)
    .map((entry) => ({ address: entry.address, family: entry.family }))
}

export function normalizeHost(host: string) {
  return host.trim().replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase()
}

export function isMetadataHost(host: string) {
  const normalized = normalizeHost(host)
  return METADATA_HOSTS.has(normalized) || normalized.endsWith(".metadata.google.internal")
}

export function isLoopbackHostName(host: string) {
  const normalized = normalizeHost(host)
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true
  const literal = parseIpLiteral(normalized)
  return literal !== undefined && classifyIp(literal.address) === "loopback"
}

/**
 * Parses IPv4 (including decimal, octal, hex, and shorthand forms via WHATWG URL canonicalization)
 * and IPv6 literals (with optional zone IDs stripped for classification).
 */
export function parseIpLiteral(host: string): ResolvedAddress | undefined {
  const normalized = normalizeHost(host)
  if (!normalized) return undefined
  // Strip IPv6 zone identifier if present (e.g. fe80::1%eth0)
  const zoneIndex = normalized.indexOf("%")
  const bare = zoneIndex >= 0 ? normalized.slice(0, zoneIndex) : normalized
  const kind = isIP(bare)
  if (kind === 4) return { address: bare, family: 4 }
  if (kind === 6) return { address: bare, family: 6 }
  // Catch non-standard IPv4 forms like 2130706433, 0x7f000001, 0177.0.0.1, 127.1
  if (!bare.includes(":") && /^[0-9a-fx.]+$/i.test(bare)) {
    const parsed = URL.parse(`http://${bare}/`)
    if (parsed && isIP(parsed.hostname) === 4) return { address: parsed.hostname, family: 4 }
  }
  return undefined
}

export function classifyIp(input: string): AddressClass {
  const zoneIndex = input.indexOf("%")
  const address = (zoneIndex >= 0 ? input.slice(0, zoneIndex) : input).trim().toLowerCase()
  const kind = isIP(address)
  if (kind === 4) return classifyIpv4(parseIpv4(address))
  if (kind === 6) return classifyIpv6(parseIpv6(address))
  return "reserved"
}

function parseIpv4(address: string): number {
  const parts = address.split(".")
  return (
    (((Number(parts[0]) << 24) >>> 0) |
      ((Number(parts[1]) << 16) >>> 0) |
      ((Number(parts[2]) << 8) >>> 0) |
      (Number(parts[3]) >>> 0)) >>>
    0
  )
}

function classifyIpv4(ip: number): AddressClass {
  const a = (ip >>> 24) & 0xff
  const b = (ip >>> 16) & 0xff
  const c = (ip >>> 8) & 0xff
  const d = ip & 0xff

  // 169.254.0.0/16 (link-local & AWS/GCP/Azure IMDS) and 100.100.100.200 (Alibaba IMDS)
  if (a === 169 && b === 254) return "metadata"
  if (a === 100 && b === 100 && c === 100 && d === 200) return "metadata"
  // 0.0.0.0/8 (unspecified), 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved + broadcast)
  if (a === 0 || a >= 224) return "reserved"
  // 127.0.0.0/8 (loopback)
  if (a === 127) return "loopback"
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT)
  if (a === 10) return "private"
  if (a === 172 && b >= 16 && b <= 31) return "private"
  if (a === 192 && b === 168) return "private"
  if (a === 100 && b >= 64 && b <= 127) return "private"
  return "public"
}

function parseIpv6(address: string): Uint8Array {
  const bytes = new Uint8Array(16)
  // Handle embedded IPv4 tail like ::ffff:127.0.0.1
  let working = address
  const lastColon = working.lastIndexOf(":")
  const tail = lastColon >= 0 ? working.slice(lastColon + 1) : ""
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail)
    const hi = ((v4 >>> 16) & 0xffff).toString(16)
    const lo = (v4 & 0xffff).toString(16)
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`
  }
  const halves = working.split("::")
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : []
  const groups = new Uint16Array(8)
  left.forEach((part, index) => {
    groups[index] = parseInt(part, 16)
  })
  const rightStart = 8 - right.length
  right.forEach((part, index) => {
    groups[rightStart + index] = parseInt(part, 16)
  })
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >>> 8) & 0xff
    bytes[i * 2 + 1] = groups[i] & 0xff
  }
  return bytes
}

function classifyIpv6(bytes: Uint8Array): AddressClass {
  const allZero = bytes.every((value) => value === 0)
  if (allZero) return "reserved"

  // ::1 loopback
  let isLoopback = bytes[15] === 1
  for (let i = 0; i < 15 && isLoopback; i++) {
    if (bytes[i] !== 0) isLoopback = false
  }
  if (isLoopback) return "loopback"

  // ::ffff:0:0/96 (IPv4-mapped)
  const isV4Mapped =
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 0 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0 &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  if (isV4Mapped) return classifyIpv4(readUint32(bytes, 12))

  // ::ffff:0:0:0/96 (IPv4-translated)
  const isV4Translated =
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 0 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  if (isV4Translated) return classifyIpv4(readUint32(bytes, 12))

  // 64:ff9b::/96 (RFC 6052 NAT64) and 64:ff9b:1::/48 (RFC 8215 local NAT64)
  const isNat64WellKnown =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0 &&
    bytes[10] === 0 &&
    bytes[11] === 0
  if (isNat64WellKnown) return classifyIpv4(readUint32(bytes, 12))
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes[4] === 0 && bytes[5] === 1) {
    return classifyIpv4(readUint32(bytes, 12))
  }

  // 2002::/16 (6to4 embedding IPv4 in bytes 2..5)
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return classifyIpv4(readUint32(bytes, 2))

  // fe80::/10 (link-local)
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return "metadata"
  // fd00:ec2::254 (AWS IPv6 IMDS)
  const isAwsV6Imds =
    bytes[0] === 0xfd &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x0e &&
    bytes[3] === 0xc2 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0 &&
    bytes[10] === 0 &&
    bytes[11] === 0 &&
    bytes[12] === 0 &&
    bytes[13] === 0 &&
    bytes[14] === 0x02 &&
    bytes[15] === 0x54
  if (isAwsV6Imds) return "metadata"
  // ff00::/8 (multicast)
  if (bytes[0] === 0xff) return "reserved"
  // 100::/64 (RFC 6666 discard-only)
  if (
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0
  ) {
    return "reserved"
  }
  // fc00::/7 (Unique Local Address)
  if ((bytes[0] & 0xfe) === 0xfc) return "private"
  return "public"
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (((bytes[offset] << 24) >>> 0) |
      ((bytes[offset + 1] << 16) >>> 0) |
      ((bytes[offset + 2] << 8) >>> 0) |
      (bytes[offset + 3] >>> 0)) >>>
    0
  )
}
