export * as McpTls from "./tls.js"

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs"
import { isIP } from "node:net"
import { homedir } from "node:os"
import path from "node:path"
import tls from "node:tls"
import type { ConfigMCP } from "@opencode/schema/config/mcp"

const PEM_CERT_HEADER = "-----BEGIN CERTIFICATE-----"
const PEM_CERT_FOOTER = "-----END CERTIFICATE-----"
const MAX_CA_FILE_SIZE = 1024 * 1024
const FINGERPRINT_PATTERN = /^(?:SHA256:)?(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$|^(?:SHA256:)?[0-9A-Fa-f]{64}$/

/**
 * Resolve a CA file path: `~` expands to the home directory, absolute paths pass through,
 * and relative paths resolve from the workspace directory.
 */
export function resolveFilePath(filePath: string, workspaceDir: string): string {
  if (filePath.startsWith("~")) return path.join(homedir(), filePath.slice(2))
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(workspaceDir, filePath)
}

/**
 * Validate that content holds at least one well-formed PEM certificate block. Cryptographic
 * validation is the TLS layer's job at connection time; certificates may be concatenated, so
 * only the first BEGIN/END pair must be complete.
 */
export function validatePemCert(content: string, source: string): void {
  const beginIdx = content.indexOf(PEM_CERT_HEADER)
  if (beginIdx === -1) throw new Error(`${source}: missing PEM certificate header ("${PEM_CERT_HEADER}")`)
  const endIdx = content.indexOf(PEM_CERT_FOOTER, beginIdx)
  if (endIdx === -1) throw new Error(`${source}: missing PEM certificate footer ("${PEM_CERT_FOOTER}")`)
  if (content.slice(beginIdx + PEM_CERT_HEADER.length, endIdx).trim().length === 0)
    throw new Error(`${source}: empty PEM certificate body`)
}

/**
 * Validate a SHA256 fingerprint and normalize it to lowercase hex without prefix or colons.
 */
export function validateFingerprint(raw: string): string {
  const trimmed = raw.trim()
  if (!FINGERPRINT_PATTERN.test(trimmed))
    throw new Error(
      `Invalid SHA256 fingerprint: "${trimmed}". Expected 64 hex characters, ` +
        `optionally prefixed with "SHA256:" and separated by colons (e.g. "SHA256:AA:BB:CC:DD:...").`,
    )
  return trimmed.replace(/^SHA256:/i, "").replace(/:/g, "").toLowerCase()
}

/**
 * Read and validate a CA certificate file. The file is opened once and the descriptor is used
 * for both stat and read, so it cannot change between validation and content retrieval.
 */
export function readCaFile(filePath: string, workspaceDir: string): string {
  const resolved = resolveFilePath(filePath, workspaceDir)
  let fd: number
  try {
    fd = openSync(resolved, "r")
  } catch {
    throw new Error(`CA file not found: ${filePath}`)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`CA path is not a file: ${filePath}`)
    if (stat.size > MAX_CA_FILE_SIZE)
      throw new Error(`CA file too large (${stat.size} bytes, max ${MAX_CA_FILE_SIZE}): ${filePath}`)
    const content = readFileSync(fd, "utf-8").trim()
    validatePemCert(content, filePath)
    return content
  } finally {
    closeSync(fd)
  }
}

/**
 * Build the PEM CA bundle for a server's TLS config. An empty result means "use the system
 * trust store". A pinned fingerprint opens one pre-flight TLS connection; its certificate is
 * verified and returned as the trust anchor for the real connection.
 */
export async function buildTlsCa(config: ConfigMCP.Tls, workspaceDir: string, url: URL): Promise<string> {
  if (config.ca_pem !== undefined) validatePemCert(config.ca_pem, "ca_pem config entry")
  const pinned = config.fingerprint !== undefined ? await pinFingerprint(config.fingerprint, url) : undefined
  return [
    config.ca_pem,
    config.ca_file !== undefined ? readCaFile(config.ca_file, workspaceDir) : undefined,
    pinned,
  ]
    .filter((part): part is string => part !== undefined)
    .join("")
}

/**
 * Wrap a fetch so its requests trust the given CA. The trust is scoped to the returned fetch
 * and does not affect other connections, including redirects it follows.
 */
export function withTlsCa(
  ca: string,
  base: (url: string | URL, init?: RequestInit) => Promise<Response>,
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return (url, init) => base(url, { ...init, tls: { ca } } as BunFetchRequestInit)
}

function pinFingerprint(raw: string, url: URL): Promise<string> {
  const expected = validateFingerprint(raw)
  return verifyServerFingerprint(url.hostname, port(url), expected)
}

/**
 * Open a raw TLS socket, compare the presented certificate's SHA256 fingerprint, and return the
 * certificate as PEM. This is the only place verification is relaxed (rejectUnauthorized: false),
 * and only to read the certificate; the socket is destroyed before any application data is sent.
 */
function verifyServerFingerprint(hostname: string, portNumber: number, expectedFingerprint: string): Promise<string> {
  return probeCertificate(hostname, portNumber).then((cert) => {
    if (cert.fingerprint !== expectedFingerprint)
      throw new Error(
        `Certificate fingerprint mismatch.\nExpected: ${expectedFingerprint}\nGot:      ${cert.fingerprint}`,
      )
    return cert.pem
  })
}

export interface Certificate {
  /** The presented certificate as PEM, usable as a trust anchor. */
  readonly pem: string
  /** SHA256 fingerprint, lowercase hex without colons. */
  readonly fingerprint: string
  /** Distinguished name of the certificate subject, e.g. "CN=OPNsense, O=Foo Corp". */
  readonly subject: string
  /** Expiry as epoch milliseconds. */
  readonly validTo: number
}

/**
 * Read the certificate a server presents without validating it against any trust store. The
 * socket is destroyed before any application data is sent.
 */
export function probeCertificate(hostname: string, portNumber: number): Promise<Certificate> {
  return new Promise<Certificate>((resolve, reject) => {
    // SNI rejects IP literals as server names, but LAN appliances are exactly the servers this
    // feature targets, so omit the server name for IP addresses.
    const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
    const socket = tls.connect({
      host: hostname,
      port: portNumber,
      rejectUnauthorized: false,
      ...(isIP(bare) === 0 ? { servername: hostname } : {}),
    })
    const fail = (message: string) => {
      socket.destroy()
      reject(new Error(message))
    }
    socket.once("secureConnect", () => {
      const cert = socket.getPeerX509Certificate()
      if (!cert) return fail("No certificate presented by server")
      const presented = cert.fingerprint256
      if (!presented) return fail("Could not compute certificate fingerprint")
      const validTo = new Date(cert.validTo).getTime()
      if (Number.isNaN(validTo)) return fail("Could not parse certificate validity")
      socket.destroy()
      resolve({
        pem: derToPem(cert.raw),
        fingerprint: presented.replace(/:/g, "").toLowerCase(),
        subject: cert.subject,
        validTo,
      })
    })
    socket.once("error", (err: Error) => {
      socket.destroy()
      reject(new Error(`TLS pre-flight connection failed: ${err.message}`))
    })
    socket.setTimeout(10_000, () => {
      socket.destroy()
      reject(new Error("TLS pre-flight connection timed out"))
    })
  })
}

/**
 * The port of a server URL, with the scheme default when none is stated.
 */
export function port(url: URL): number {
  return Number(url.port) || (url.protocol === "https:" ? 443 : 80)
}

/**
 * Return the host (brackets stripped) when it is a private IP literal: RFC 1918, loopback,
 * link-local, or IPv6 unique-local. Public addresses and all hostnames return undefined.
 * Hostnames are excluded because their DNS mapping is attacker-controllable, unlike an IP
 * literal written in the configuration.
 */
export function privateHost(hostname: string): string | undefined {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  const version = isIP(bare)
  if (version === 4) return isPrivateIPv4(bare) ? bare : undefined
  if (version === 6) return isPrivateIPv6(bare) ? bare : undefined
  return undefined
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number)
  if (a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateIPv6(host: string): boolean {
  const groups = expandIPv6(host)
  if (!groups) return false
  if (groups.every((group, index) => (index === groups.length - 1 ? group === 1 : group === 0))) return true
  const first = groups[0]
  if (first >= 0xfe80 && first <= 0xfebf) return true
  if (first >= 0xfc00 && first <= 0xfdff) return true
  return false
}

function expandIPv6(host: string): number[] | undefined {
  const halves = host.split("::")
  if (halves.length > 2) return undefined
  const parseHalf = (text: string): number[] | undefined => {
    if (text === "") return []
    const groups: number[] = []
    for (const part of text.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined
      groups.push(parseInt(part, 16))
    }
    return groups
  }
  const head = parseHalf(halves[0] ?? "")
  const tail = halves.length === 2 ? parseHalf(halves[1]) : []
  if (!head || !tail) return undefined
  if (halves.length === 2 && head.length + tail.length > 7) return undefined
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail] : head
  return groups.length === 8 ? groups : undefined
}

/**
 * Convert a DER certificate to PEM so it can be used as a trust anchor. Bytes are base64-encoded
 * in chunks to keep the spread argument small on large certificates.
 */
export function derToPem(der: ArrayBuffer): string {
  const bytes = new Uint8Array(der)
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 4096) chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 4096))))
  const lines = chunks.join("").match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`
}
