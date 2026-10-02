export * as ProxyAuthNtlm from "./ntlm"

import type { ProxyAuthNative } from "../native"
import type { ProxyAuthContext, ProxyAuthProvider } from "./provider"

/**
 * NTLM provider backed by the optional native addon. It performs the stateful
 * Type1 → Type3 exchange: the first step produces a Type1 message, and a later
 * step carrying the server's Type2 token (from `Proxy-Authenticate`) produces
 * the Type3 message.
 */
export function ntlm(native: ProxyAuthNative): ProxyAuthProvider {
  return {
    scheme: "ntlm",
    async step(ctx: ProxyAuthContext, challenge: string) {
      const token = challenge.replace(/^NTLM\s*/i, "").trim()
      if (!token) {
        const type1 = native.ntlm.createType1(domainOf(ctx.username), undefined)
        return type1.length ? `NTLM ${Buffer.from(type1).toString("base64")}` : undefined
      }
      const type3 = native.ntlm.createType3(
        Buffer.from(token, "base64"),
        ctx.username ?? "",
        ctx.password ?? "",
        domainOf(ctx.username),
      )
      return type3.length ? `NTLM ${Buffer.from(type3).toString("base64")}` : undefined
    },
  }
}

function domainOf(username: string | undefined): string | undefined {
  const separator = username?.indexOf("\\") ?? -1
  return separator > 0 ? username?.slice(0, separator) : undefined
}
