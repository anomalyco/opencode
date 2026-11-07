# A10: URL hosts must be ASCII

TypeScript: `new URL` follows the WHATWG URL standard, which maps an international host name to
its punycode form with UTS 46. `https://bücher.example` parses as `https://xn--bcher-kva.example/`.

Rust: the `url` crate is built with the `idna_adapter` 1.0.0 stub (pinned in the root
`Cargo.toml`, used by `crates/api`), which turns IDNA off. A host with a non-ASCII character fails
to parse. A punycode host (`https://xn--bcher-kva.example`) and every ASCII host parse as before.

Where a user can type such a URL, the failure is reported:

- `--server` and any other base URL given to `opencode_api::Client`: "<url>: a host name must be
  ASCII; write an international name in its punycode (xn--) form".
- MCP and form URL fields (`format: uri`): "Expected a URL", as for any URL that does not parse.
- Opening a link: "Only http and https links can be opened in the browser: <url>".

The stub also stops `url` from checking UTS 46 rules on punycode labels, so a malformed `xn--`
label parses where TypeScript rejects it; the server or DNS rejects it later.

Reason: decision O-58 (E1). Full IDNA pulls ICU4X into the build, 21 crates with 2 build scripts
and 4 proc macros, for host names that a user can write in punycode.
