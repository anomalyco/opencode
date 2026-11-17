# Published V2 TUI plugins, as npm ships them (P8)

The tarballs of the npm packages below, byte for byte as the registry serves them (MIT or 0BSD, each with its license
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
| `opencode-model-quick-switch.tgz` | `opencode-model-quick-switch@0.1.0` (field test FT-6) | `sha512-AHOLNV5oO/FozOWgUOnu7GaZhzFUn69WUSNhQ+NtLbZV+z0psbJ5MVhclAYA1Cr4YLDag/1hgPRSO6glIxIdqg==` |
| `opencode-sidebar-tokens.tgz` | `opencode-sidebar-tokens@0.1.3` (field test FT-7) | `sha512-tx/FBEbZJJ1mwdYMg3rKvUdthtkETLHYqeg26cM3f1Z1a0yzlM1kCG2ymp1GbjevLrNUWqUEparQJFG6CfeLzQ==` |
| `opencode-plugin-context.tgz` | `opencode-plugin-context@2.0.2` (catalog CT-9) | `sha512-6rDmEGNqO+7ozS0lYoa1Hw6srd3hFLy8IXexd8xugmvsTw43wnUB5C3tj/30FjlCCfsUpp+R3HdgfvSelxyhSA==` |
| `opencode-file-browser.tgz` | `opencode-file-browser@1.0.4` (catalog CT-11) | `sha512-gnpKQHYyjlqEDZcTtH8V4IiuhNSML9IOp9AyJLFDMxqr5R3A8gc3ZQhWq8TR2ewwox4K7iU5gOshfXYx5EBB+g==` |
| `mighty-reviewer.tgz` | `mighty-reviewer@0.14.0` (catalog CT-18) | `sha512-2v8eUKRogeXXPyJ6d5G7APEFKDpl25JJCZiHgSqNd8MlITS4T1jJ1WrpaZxbfrqXDzOdrzk+Tit7dUMpPQsYBw==` |
| `@kud__opencode-shell-highlighting.tgz` | `@kud/opencode-shell-highlighting@0.1.0` (catalog CT-16) | `sha512-K87SETtIvua6nXSromnNYFPrSSX5xopEwZ426cg0MjkSqQJ7zccnNMwkkgq1b5oW8Tq7oL4x0mKbW++ZFDgifQ==` |
| `opencode-rundev.tgz` | `opencode-rundev@0.1.5` (catalog CT-19) | `sha512-fHiuKD7BhD8CC6Xh1sZLjTxPJYDIJSDHFiIRpPPn9576m+FngIt+fx4OWP0dHpL889+ONwIRccJuapIoXRpkxw==` |
| `@joe-broadhead__opencode-tavily.tgz` | `@joe-broadhead/opencode-tavily@0.0.7` (catalog CT-22) | `sha512-+KmDCMP9j085+FRX7gYbGIRe474M2hDU9YUT/8E2roHg2yELugsMNR1Ta/1rc2eeJ9yn+vcheJnnq7sPntj8Xw==` |
| `opencode-navigator.tgz` | `opencode-navigator@0.27.7` (catalog CT-21) | `sha512-Rt5p1v24ssRdG4u2JBseomSmxcQ2c4YBfRwwebsWLNThCQNZogojd3oo8W7ZvTT/es9DeT9JLD0sLX23IVtREA==` |
| `@joe-broadhead__opencode-linear.tgz` | `@joe-broadhead/opencode-linear@0.0.9` (catalog CT-8) | `sha512-JKi7qnHOXusxcPFb8jcrsKj/6zVMsWSLv0P3PWVTFOb+aGf3yaHUwR+8RL7wny8Unfbo6HzdqojEbT2L44K10g==` |

`integrity.json` pins the same digests; TS's recorder (`parity/app/scenarios.test.tsx`) and the Rust rows
(`crates/tui/tests/all/{app,ports}.rs`) refuse a tarball whose SHA-512 is not its pin before they unpack it.

A scope's `/` is `__` in the file name. Check one against the registry:

```sh
openssl dgst -sha512 -binary opencode-session-usage.tgz | base64 -w0
curl -s https://registry.npmjs.org/opencode-session-usage/0.1.8 | jq -r .dist.integrity
```
