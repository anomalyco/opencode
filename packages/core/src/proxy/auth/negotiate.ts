export * as ProxyAuthNegotiate from "./negotiate"

import type { ProxyAuthNative } from "../native"
import type { ProxyAuthContext, ProxyAuthProvider } from "./provider"

/**
 * Negotiate (Kerberos/SPNEGO) provider backed by the optional native addon.
 * The SPN follows RFC 4559: `HTTP/<proxy-hostname>`.
 */
export function negotiate(native: ProxyAuthNative): ProxyAuthProvider {
  return {
    scheme: "negotiate",
    async step(ctx: ProxyAuthContext) {
      const token = await native.negotiate(`HTTP/${ctx.proxy.hostname}`)
      if (!token.length) return undefined
      return `Negotiate ${Buffer.from(token).toString("base64")}`
    },
  }
}
