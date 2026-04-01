const SSL_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_SIGNATURE_FAILURE",
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "CERT_REVOKED",
  "CERT_REJECTED",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_CHAIN_TOO_LONG",
  "PATH_LENGTH_EXCEEDED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
])

export type ConnectionErrorInfo = {
  code: string
  message: string
  ssl: boolean
  stale: boolean
}

export function extract(error: unknown): ConnectionErrorInfo | undefined {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && "code" in current && typeof current.code === "string") {
      const code = current.code
      return {
        code,
        message: current.message,
        ssl: SSL_CODES.has(code),
        stale: code === "ECONNRESET" || code === "EPIPE",
      }
    }
    if (current instanceof Error && "cause" in current && current.cause !== current) {
      current = current.cause
    } else break
  }
  return undefined
}

export function format(info: ConnectionErrorInfo): string {
  if (info.code === "ETIMEDOUT") return "Request timed out. Check your internet connection and proxy settings"
  if (info.stale) return `Connection reset (${info.code}). Retrying with fresh connection.`
  if (!info.ssl) return `Unable to connect to API (${info.code})`

  switch (info.code) {
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "SSL certificate verification failed. If behind a corporate proxy, set NODE_EXTRA_CA_CERTS to your CA bundle path."
    case "CERT_HAS_EXPIRED":
      return "SSL certificate has expired"
    case "CERT_REVOKED":
      return "SSL certificate has been revoked"
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "Self-signed certificate detected. If behind a corporate proxy, set NODE_EXTRA_CA_CERTS to your CA bundle path."
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "HOSTNAME_MISMATCH":
      return "SSL certificate hostname mismatch"
    case "CERT_NOT_YET_VALID":
      return "SSL certificate is not yet valid"
    default:
      return `SSL error (${info.code}). If behind a corporate proxy, set NODE_EXTRA_CA_CERTS to your CA bundle path.`
  }
}
