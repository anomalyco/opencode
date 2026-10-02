export * as ProxyAuthProvider from "./provider"

import { basic } from "./basic"
import { negotiate } from "./negotiate"
import type { ProxyAuthNative } from "../native"
import type { ProxyAuth } from "../resolve"

export type ProxyAuthScheme = "negotiate" | "ntlm" | "basic"

export interface ProxyAuthContext {
  proxy: URL
  target: string
  username?: string
  password?: string
}

export interface ProxyAuthProvider {
  readonly scheme: ProxyAuthScheme
  /** Produce the next `Proxy-Authorization` value for a challenge, or undefined when it cannot proceed. */
  step(ctx: ProxyAuthContext, challenge: string): Promise<string | undefined>
}

const order: ProxyAuthScheme[] = ["negotiate", "ntlm", "basic"]

/**
 * Map the advertised `Proxy-Authenticate` schemes to providers, ordered
 * Negotiate → NTLM → Basic. Negotiate and NTLM are only available when the
 * optional native addon is loaded, so `auto` falls through to Basic without it.
 */
export function selectProviders(
  auth: ProxyAuth,
  challenged: readonly string[],
  native?: ProxyAuthNative,
): readonly ProxyAuthProvider[] {
  if (auth === "none") return []
  const advertised = new Set(challenged.map((value) => value.trim().split(/\s/, 1)[0].toLowerCase()))
  const selected = auth === "auto" ? order : [auth]
  return selected
    .filter((scheme) => advertised.has(scheme))
    .map((scheme) => factory(scheme, native))
    .filter((provider): provider is ProxyAuthProvider => provider !== undefined)
}

function factory(scheme: ProxyAuthScheme, native?: ProxyAuthNative): ProxyAuthProvider | undefined {
  if (scheme === "basic") return basic
  if (!native) return undefined
  if (scheme === "negotiate") return negotiate(native)
  return undefined
}
