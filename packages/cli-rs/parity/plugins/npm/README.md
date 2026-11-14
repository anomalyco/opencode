# Published V2 TUI plugins, as npm ships them (P8)

The tarballs of three npm packages, byte for byte as the registry serves them (MIT, each with its license inside). The
P8 scenarios load them unmodified in both clients: TS through its plugin loader, the Rust client on the JS host
through the V2 compatibility layer. Before a scenario runs, each side unpacks the tarball a `plugins` entry
`./out/npm/node_modules/<name>` names into that directory (`parity/out` is ignored), so the package sits under
`node_modules` as an install puts it, and TS compiles it as it compiles an installed package.

| Tarball | Package | `dist.integrity` |
| --- | --- | --- |
| `opencode-subagents-sidebar.tgz` | `opencode-subagents-sidebar@0.1.6` | `sha512-` of the file, equal to the registry's |
| `@mynameistito__opencode-force-input.tgz` | `@mynameistito/opencode-force-input@1.1.20` | same |
| `opencode-session-usage.tgz` | `opencode-session-usage@0.1.8` | same |

A scope's `/` is `__` in the file name. Check one against the registry:

```sh
openssl dgst -sha512 -binary opencode-session-usage.tgz | base64 -w0
curl -s https://registry.npmjs.org/opencode-session-usage/0.1.8 | jq -r .dist.integrity
```
