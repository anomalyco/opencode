export * as ProxyAuthNative from "./native"

/**
 * The OS-backed proxy authentication primitives, implemented by the optional
 * `@opencode-ai/proxy-auth-native` addon (Windows SSPI, macOS/Linux GSSAPI).
 */
export interface ProxyAuthNative {
  /** Produce a SPNEGO/Kerberos token for the given SPN (for example `HTTP/proxy.example`). */
  negotiate(spn: string): Promise<Uint8Array>
  ntlm: {
    createType1(domain?: string, workstation?: string): Uint8Array
    createType3(type2: Uint8Array, username: string, password: string, domain?: string): Uint8Array
  }
}

const MODULE = "@opencode-ai/proxy-auth-native"

let cached: Promise<ProxyAuthNative | undefined> | undefined

/**
 * Load the optional native addon once. Returns `undefined` when it is not
 * installed or fails to load, so callers degrade to Basic instead of crashing.
 */
export function load(): Promise<ProxyAuthNative | undefined> {
  cached ??= import(MODULE)
    .then((module) => ("default" in module ? (module.default as ProxyAuthNative) : (module as ProxyAuthNative)))
    .catch(() => undefined)
  return cached
}
