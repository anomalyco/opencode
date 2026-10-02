export * as ProxyError from "./error"

export type ProxyAuthErrorKind = "no-credentials" | "rejected" | "missing-native" | "rounds-exceeded"

const messages: Record<ProxyAuthErrorKind, string> = {
  "no-credentials":
    "Proxy requires authentication (Negotiate/NTLM/Basic). Configure the `proxy` section in opencode.json, or run `kinit` for an OS ticket.",
  rejected: "Proxy credentials were rejected.",
  "missing-native":
    "Proxy authentication needs the optional native addon, which is not installed. Install @opencode-ai/proxy-auth-native, or configure Basic credentials.",
  "rounds-exceeded": "Proxy authentication did not complete within the allowed number of attempts.",
}

/** Remove credentials from a proxy URL before it reaches a log or an error. */
export function scrubProxy(proxy: string): string {
  try {
    const url = new URL(proxy)
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return proxy.replace(/\/\/[^@/]*@/, "//")
  }
}

/**
 * A proxy-authentication failure with a stable `kind` and an actionable,
 * credential-free message.
 */
export class ProxyAuthError extends Error {
  readonly kind: ProxyAuthErrorKind
  readonly proxy: string

  constructor(kind: ProxyAuthErrorKind, options: { proxy: string }) {
    const proxy = scrubProxy(options.proxy)
    super(`${messages[kind]} (proxy ${proxy})`)
    this.name = "ProxyAuthError"
    this.kind = kind
    this.proxy = proxy
  }
}
