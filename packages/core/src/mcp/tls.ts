export * as McpTls from "./tls.js"

import { createHash } from "node:crypto"
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs"
import { isIP } from "node:net"
import { homedir } from "node:os"
import path from "node:path"
import tls, { type PeerCertificate } from "node:tls"
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
 * The trust rules a server's connections are subject to. `ca` is a PEM trust anchor bundle;
 * `fingerprint` pins one exact certificate, whose SHA256 fingerprint is re-checked on every
 * handshake.
 */
export type ResolvedTls = {
  readonly ca: string
  readonly fingerprint?: string
}

/**
 * Resolve a server's TLS config into the trust rules for its connections. An undefined result
 * means "use the system trust store". A pinned fingerprint opens one pre-flight TLS connection;
 * the presented certificate must match it exactly and becomes the trust anchor for the real
 * connection, so chain verification only accepts that certificate. Name matching is deliberately
 * not enforced: LAN appliance certificates often omit the IP SANs a hostname check would require,
 * and the fingerprint already identifies the certificate the user pinned.
 */
export async function resolveTls(
  config: ConfigMCP.Tls,
  workspaceDir: string,
  url: URL,
): Promise<ResolvedTls | undefined> {
  if (config.fingerprint !== undefined) {
    const expected = validateFingerprint(config.fingerprint)
    const cert = await probeCertificate(url.hostname, port(url))
    if (cert.fingerprint !== expected)
      throw new Error(`Certificate fingerprint mismatch.\nExpected: ${expected}\nGot:      ${cert.fingerprint}`)
    return { ca: cert.pem, fingerprint: expected }
  }
  if (config.ca_pem !== undefined) validatePemCert(config.ca_pem, "ca_pem config entry")
  const ca = [
    config.ca_pem,
    config.ca_file !== undefined ? readCaFile(config.ca_file, workspaceDir) : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("")
  return ca === "" ? undefined : { ca }
}

/**
 * Wrap a fetch so its requests apply the resolved TLS trust rules. The trust is scoped to the
 * returned fetch and does not affect other connections, including redirects it follows. A pinned
 * fingerprint anchors chain verification to the pinned certificate itself, and the identity hook
 * replaces the hostname check while re-checking the fingerprint on every handshake.
 */
export function withTls(
  resolved: ResolvedTls,
  base: (url: string | URL, init?: RequestInit) => Promise<Response>,
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const fingerprint = resolved.fingerprint
  if (fingerprint !== undefined) {
    return (url, init) =>
      base(url, {
        ...init,
        tls: {
          ca: resolved.ca,
          // Replaces the hostname check: returning undefined accepts the certificate (even one
          // without an IP SAN), returning an Error rejects it.
          checkServerIdentity: (_hostname: string, cert: PeerCertificate) => {
            const presented = createHash("sha256").update(cert.raw).digest("hex")
            if (presented !== fingerprint)
              return new Error(`Certificate fingerprint mismatch.\nExpected: ${fingerprint}\nGot:      ${presented}`)
          },
        },
      } as BunFetchRequestInit)
  }
  return (url, init) => base(url, { ...init, tls: { ca: resolved.ca } } as BunFetchRequestInit)
}

/**
 * True when a connection failure is a TLS certificate verification error rather than a network,
 * protocol, or HTTP failure. Current runtimes report these as message-only errors ("self signed
 * certificate", "ERR_TLS_CERT_ALTNAME_INVALID", "certificate has expired"); Node-style codes are
 * matched as well for the runtimes that expose them.
 */
export function isTlsCertificateError(error: unknown): boolean {
  const patterns = [
    /self[- ]signed/i,
    /ERR_TLS_CERT_ALTNAME_INVALID|CERT_ALTNAME/i,
    /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to verify/i,
    /CERT_HAS_EXPIRED|certificate has expired/i,
    /DEPTH_ZERO/i,
  ]
  let current: unknown = error
  for (let depth = 0; depth < 5; depth++) {
    if (!(current instanceof Error)) break
    const code = (current as { code?: unknown }).code
    const text = `${code === undefined ? "" : `${code} `}${current.message}`
    if (patterns.some((pattern) => pattern.test(text))) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
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
