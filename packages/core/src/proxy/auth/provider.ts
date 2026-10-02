export * as ProxyAuthProvider from "./provider"

import { basic } from "./basic"
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

const negotiate: ProxyAuthProvider = {
  scheme: "negotiate",
  step: async () => undefined,
}

const ntlm: ProxyAuthProvider = {
  scheme: "ntlm",
  step: async () => undefined,
}

// Providers not yet wired to a native token source still participate in
// selection so the ordering is stable; they decline until Task 10/11 supply one.
const providers: Record<ProxyAuthScheme, ProxyAuthProvider> = { negotiate, ntlm, basic }

const order: ProxyAuthScheme[] = ["negotiate", "ntlm", "basic"]

/** Map the advertised `Proxy-Authenticate` schemes to providers, ordered Negotiate → NTLM → Basic. */
export function selectProviders(auth: ProxyAuth, challenged: readonly string[]): readonly ProxyAuthProvider[] {
  if (auth === "none") return []
  const advertised = new Set(challenged.map((value) => value.trim().toLowerCase()))
  const selected = auth === "auto" ? order : [auth]
  return selected.filter((scheme) => advertised.has(scheme)).map((scheme) => providers[scheme])
}
