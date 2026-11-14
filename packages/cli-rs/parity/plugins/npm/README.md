# Published V2 TUI plugins, as npm ships them (P8)

The tarballs of four npm packages, byte for byte as the registry serves them (MIT or 0BSD, each with its license
inside). The P8 scenarios load them unmodified in both clients: TS through its plugin loader, the Rust client on the JS
host through the V2 compatibility layer. Before a scenario runs, each side unpacks the tarball a `plugins` entry
`./out/npm/node_modules/<name>` names into that directory (`parity/out` is ignored), so the package sits under
`node_modules` as an install puts it, and TS compiles it as it compiles an installed package.

| Tarball | Package | `dist.integrity`, equal to the registry's |
| --- | --- | --- |
| `opencode-subagents-sidebar.tgz` | `opencode-subagents-sidebar@0.1.6` | `sha512-Six0zMfLg3zSwkC5Wrflxj+/KtSv7D/iTfZH8xE1znZ7xvcmj30+oxY0hnfYxMfz8lkveYjiuqQrXT3BClq69A==` |
| `@mynameistito__opencode-force-input.tgz` | `@mynameistito/opencode-force-input@1.1.20` | `sha512-DcFpUaOYtdQzk+xDix+VxP2cFWVoGv7idT0/l6Hguh+LDRVwqGySZLyS2v5Y+E/VlAnvrtjIJEo5Ysy8ie1Pow==` |
| `opencode-session-usage.tgz` | `opencode-session-usage@0.1.8` | `sha512-x8nNJJpMaYNSaAIVcLXl+RXItK5MuVVOB8t99nsYuZXAsAw4GtwufQLzoxDRaedVIIHYWw54Bxdrg+pEbmiTow==` |
| `opencode-sidebar-prompt.tgz` | `opencode-sidebar-prompt@0.1.6` | `sha512-QgSndS0jbpI7ZC9qf59XqzX5xcaSyA8xTyBwSV2XUJAELRA0tsLlg9ILYSvIimAgmn7PFOVJgWCiHqux98gUiA==` |

`integrity.json` pins the same digests; TS's recorder (`parity/app/scenarios.test.tsx`) and the Rust rows
(`crates/tui/tests/all/{app,ports}.rs`) refuse a tarball whose SHA-512 is not its pin before they unpack it.

A scope's `/` is `__` in the file name. Check one against the registry:

```sh
openssl dgst -sha512 -binary opencode-session-usage.tgz | base64 -w0
curl -s https://registry.npmjs.org/opencode-session-usage/0.1.8 | jq -r .dist.integrity
```
