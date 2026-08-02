import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import tls from "node:tls"

const PEM_CERT_HEADER = "-----BEGIN CERTIFICATE-----"
const PEM_CERT_FOOTER = "-----END CERTIFICATE-----"
const MAX_CA_FILE_SIZE = 1024 * 1024
const FINGERPRINT_PATTERN = /^(?:SHA256:)?(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$|^(?:SHA256:)?[0-9A-Fa-f]{64}$/

/**
 * Resolve a file path, expanding `~` to the user home directory.
 * Absolute paths are returned as-is. Relative paths are resolved against the workspace directory.
 */
export function resolveFilePath(filePath: string, workspaceDir: string): string {
  if (filePath.startsWith("~")) return path.join(homedir(), filePath.slice(2))
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(workspaceDir, filePath)
}

/**
 * Validate that a string contains at least one valid PEM certificate block.
 * Checks for the required BEGIN/END markers. Does not validate the certificate
 * cryptographically — that is left to the TLS layer at connection time.
 *
 * Certificates may be concatenated (CA bundle), so multiple BEGIN/END pairs
 * are accepted as long as the first one is well-formed.
 */
export function validatePemCert(content: string, source: string): void {
  const beginIdx = content.indexOf(PEM_CERT_HEADER)
  if (beginIdx === -1) throw new Error(`${source}: missing PEM certificate header ("${PEM_CERT_HEADER}")`)
  const endIdx = content.indexOf(PEM_CERT_FOOTER, beginIdx)
  if (endIdx === -1) throw new Error(`${source}: missing PEM certificate footer ("${PEM_CERT_FOOTER}")`)
  const between = content.slice(beginIdx + PEM_CERT_HEADER.length, endIdx)
  if (between.trim().length === 0) throw new Error(`${source}: empty PEM certificate body`)
}

/**
 * Validate a SHA256 fingerprint string.
 * Accepts formats like:
 *   "SHA256:AA:BB:CC:DD:..." (with optional prefix and colons)
 *   "AA:BB:CC:DD:..." (with colons, no prefix)
 *   "AABBCCDD..." (bare hex, no colons)
 *
 * Returns the normalized lowercase hex string (64 chars, no prefix, no colons).
 */
export function validateFingerprint(raw: string): string {
  const trimmed = raw.trim()
  if (!FINGERPRINT_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid SHA256 fingerprint: "${trimmed}". Expected 64 hex characters, ` +
        `optionally prefixed with "SHA256:" and separated by colons ` +
        `(e.g. "SHA256:AA:BB:CC:DD:...").`,
    )
  }
  return trimmed.replace(/^SHA256:/i, "").replace(/:/g, "").toLowerCase()
}

/**
 * Read and validate a CA certificate file (PEM format).
 *
 * Checks that the path points to a regular file (not a directory or unusual
 * device) and that the file size is within a reasonable bound. Then reads the
 * content and verifies it contains at least one well-formed PEM certificate
 * block before returning it.
 *
 * Throws with a descriptive error message for missing files, directories,
 * non-certificate content, or files that are too large.
 */
export function readCaFile(filePath: string, workspaceDir: string): string {
  const resolved = resolveFilePath(filePath, workspaceDir)
  if (!existsSync(resolved)) throw new Error(`CA file not found: ${filePath}`)

  const stat = statSync(resolved)
  if (!stat.isFile()) throw new Error(`CA path is not a file: ${filePath}`)
  if (stat.size > MAX_CA_FILE_SIZE)
    throw new Error(`CA file too large (${stat.size} bytes, max ${MAX_CA_FILE_SIZE}): ${filePath}`)

  const content = readFileSync(resolved, "utf-8").trim()
  validatePemCert(content, filePath)
  return content
}

/**
 * Normalize a certificate fingerprint for comparison.
 * Strips the optional `SHA256:` prefix and removes colons, then lowercases.
 */
function normalizeFingerprint(raw: string): string {
  return raw.replace(/^SHA256:/i, "").replace(/:/g, "").toLowerCase()
}

/**
 * Convert a DER-encoded certificate to PEM format so it can be used as a trusted CA.
 * Processes the raw bytes in chunks to avoid call-stack overflow on large certificates.
 */
function derToPem(der: ArrayBuffer): string {
  const bytes = new Uint8Array(der)
  let base64 = ""
  for (let i = 0; i < bytes.length; i += 4096) {
    const chunk = bytes.subarray(i, i + 4096)
    base64 += btoa(String.fromCharCode(...chunk))
  }
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`
}

/**
 * Pre-flight TLS connection to verify a server certificate fingerprint.
 *
 * Opens a raw TLS socket to the server, retrieves the presented certificate,
 * computes its SHA256 fingerprint, and compares it with the expected value.
 * If the fingerprint matches, the certificate is returned as a PEM string
 * that can be used as a trusted CA for subsequent connections.
 *
 * This is the only place where certificate verification is temporarily
 * relaxed (`rejectUnauthorized: false`) — and only so we can access the
 * certificate to verify its fingerprint manually. After verification,
 * the returned PEM is used as a strict trust anchor.
 * The socket is destroyed immediately after the certificate is retrieved;
 * no application data is exchanged over the unverified connection.
 */
function verifyServerFingerprint(
  hostname: string,
  port: number,
  expectedFingerprint: string,
): Promise<string> {
  const normalized = normalizeFingerprint(expectedFingerprint)

  return new Promise<string>((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port,
      rejectUnauthorized: false,
      servername: hostname,
    })

    socket.once("secureConnect", () => {
      const cert = socket.getPeerX509Certificate()
      if (!cert) {
        socket.destroy()
        reject(new Error("No certificate presented by server"))
        return
      }

      const rawFingerprint = cert.fingerprint256
      if (!rawFingerprint) {
        socket.destroy()
        reject(new Error("Could not compute certificate fingerprint"))
        return
      }

      const certFingerprint = rawFingerprint.replace(/:/g, "").toLowerCase()
      if (certFingerprint !== normalized) {
        socket.destroy()
        reject(
          new Error(
            `Certificate fingerprint mismatch.\n` +
              `Expected: ${expectedFingerprint}\n` +
              `Got:      ${rawFingerprint}`,
          ),
        )
        return
      }

      const pem = derToPem(cert.raw)
      socket.destroy()
      resolve(pem)
    })

    socket.once("error", (err) => {
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
 * Verify the server certificate fingerprint and return the certificate as PEM.
 * Validates the fingerprint format before attempting the TLS connection.
 */
export async function verifyAndPinFingerprint(url: URL, fingerprint: string): Promise<string> {
  validateFingerprint(fingerprint)
  const port = parseInt(url.port) || (url.protocol === "https:" ? 443 : 443)
  return verifyServerFingerprint(url.hostname, port, fingerprint)
}

/**
 * Create a custom `fetch` that trusts the given CA certificate(s) for all requests.
 *
 * This wraps the global `fetch` and injects the CA certificate via Bun's `tls.ca`
 * option on every request. The trust is scoped to this fetch instance only and
 * does not affect other connections in the process.
 */
export function createTlsFetch(ca: string): typeof fetch {
  return (input, init) => {
    const fetchInit = { ...init, tls: { ca } } as RequestInit & { tls: { ca: string } }
    return globalThis.fetch(input, fetchInit)
  }
}
