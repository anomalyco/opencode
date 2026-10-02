// Loads the platform-specific native binding and exposes the ProxyAuthNative
// interface consumed by @opencode-ai/core. Kept dependency-free so a missing
// prebuild fails loudly here rather than at an arbitrary import site.

export interface ProxyAuthNative {
  negotiate(spn: string): Promise<Uint8Array>
  ntlm: {
    createType1(domain?: string, workstation?: string): Uint8Array
    createType3(type2: Uint8Array, username: string, password: string, domain?: string): Uint8Array
  }
}

const targets: Record<string, string> = {
  "win32-x64": "@opencode-ai/proxy-auth-native-win32-x64",
  "darwin-arm64": "@opencode-ai/proxy-auth-native-darwin-arm64",
  "darwin-x64": "@opencode-ai/proxy-auth-native-darwin-x64",
  "linux-x64": "@opencode-ai/proxy-auth-native-linux-x64-gnu",
}

const target = targets[`${process.platform}-${process.arch}`]
if (!target) throw new Error(`proxy-auth-native has no prebuild for ${process.platform}-${process.arch}`)

const binding = (await import(target)) as ProxyAuthNative
export default binding
