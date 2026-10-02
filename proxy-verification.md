# Verifying proxy authentication against the corporate gateway

This appends to the reproduction in the original `proxy-verification.md`.
The `curl/*` User-Agent bypass is replaced by real proxy authentication.

## What changed

OpenCode now authenticates to the proxy instead of relying on a User-Agent
workaround:

- `packages/core/src/proxy/` — proxy resolution, a fetch transport that answers
  `407` with Negotiate → NTLM → Basic, and an `httpClient` layer installed at
  the shared node in `packages/core/src/effect/app-node-platform.ts`.
- `packages/proxy-auth-native/` — optional native addon (Windows SSPI,
  macOS/Linux GSSAPI). Absent ⇒ automatic fallback to Basic.
- `opencode.json` gains a `proxy` section (`url`, `auth`, `username`, `password`,
  `no_proxy`).

## Automated evidence (this machine)

`env -C packages/core bun test test/proxy/` — 32 tests against a local fake
authenticating proxy: `407` parsing, Negotiate/NTLM/Basic selection, CONNECT and
absolute-form authentication, re-auth, loopback/`no_proxy` bypass, and
credential redaction. Run it from `packages/core`, never the repo root.

## Live steps (to run on the corporate network)

The native addon needs a Rust toolchain to build, and Kerberos must be driven by
the OS, so these steps are for an environment that has both.

1. Build the addon and install dependencies:

   ```sh
   cd packages/proxy-auth-native && bun run build
   cd ../.. && bun install
   ```

2. Ensure a Kerberos ticket exists (`klist`, or sign in on Windows).

3. Point OpenCode at the gateway and confirm the fetch matrix. Before this
   change every non-allow-listed host returned `407`:

   | URL | before | expected after |
   | --- | --- | --- |
   | `https://opencode.ai/` | 407 | 200 |
   | `https://models.opencode.ai/api.json` | 407 | 200 |
   | `https://example.com/` | 407 | 200 |
   | `https://github.com/` | 200 | 200 |

4. Confirm `models.dev` refreshes: no `Failed to fetch models.dev … 407` in
   `~/.local/share/opencode/log/opencode.log`.

5. Optional: set `"auth": "basic"` with `username`/`password` to confirm the
   fallback path without the addon.

## Gateway rule

The gateway rule "`the client User-Agent rule` → set an internal app label" can be
retired once OpenCode authenticates. Keying a security decision on a spoofable
`User-Agent` header lets any client through; prefer authentication, or
allow-listing the destinations.
