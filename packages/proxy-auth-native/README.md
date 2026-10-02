# @opencode-ai/proxy-auth-native

Optional native addon providing OS-backed proxy authentication for OpenCode:

- **Windows:** SSPI (`Negotiate`/Kerberos, NTLM)
- **macOS / Linux:** GSSAPI with SPNEGO

It is an **optional** dependency. When it is absent, `@opencode-ai/core` loads
`undefined` and degrades to Basic authentication or explicit credentials.

## Interface

```ts
interface ProxyAuthNative {
  negotiate(spn: string): Promise<Uint8Array>
  ntlm: {
    createType1(domain?: string, workstation?: string): Uint8Array
    createType3(type2: Uint8Array, username: string, password: string, domain?: string): Uint8Array
  }
}
```

## Build

```sh
bun run build          # napi build --platform --release
bun run artifacts      # collect prebuilt binaries
```

Targets: `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`,
`x86_64-unknown-linux-gnu`, `x86_64-unknown-linux-musl`.

> The `native/` Rust sources are a scaffold (the local environment has no Rust
> toolchain). CI compiles the platform binaries.
