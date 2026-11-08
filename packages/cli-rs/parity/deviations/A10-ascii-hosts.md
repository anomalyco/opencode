# A10: URL hosts must be ASCII

TypeScript: `new URL` follows the WHATWG URL standard, which maps an international host name to
its punycode form with UTS 46. `https://bücher.example` parses as `https://xn--bcher-kva.example/`.

Rust: the `url` crate is built with the `idna_adapter` 1.0.0 stub (pinned in the root
`Cargo.toml`, used by `crates/api`), which turns IDNA off. A host with a non-ASCII character fails
to parse. A punycode host (`https://xn--bcher-kva.example`) and every ASCII host parse as before.

Every URL a user types goes through one parse boundary, `opencode_api::js::parse_url`, which
rejects a host that is not ASCII after percent-decoding before `url` sees it (the stub asserts on
some such hosts, for example `https://Bücher.example`). The message is "<url>: a host name must be
ASCII; write an international name in its punycode (xn--) form", from:

- `--server` and any other base URL given to `opencode_api::Client`;
- `auth login <url>`, `mcp add --url`, `session import <url>` and opening a link in the TUI;
- `pair --url`, as a usage error: "Invalid value for flag --url: "<url>". Expected: a host name
  must be ASCII; ...";
- MCP and form URL fields (`format: uri`), in the CLI prompt and the TUI form.

A pasted `file://` path with a non-ASCII host stays as typed, as any other non-local host does.

URLs from other sources go through the same boundary (`parse_url`, `join_url` and `set_host`),
and `clippy.toml` forbids calling `url`'s parsers anywhere else:

- a service registration whose URL has a non-ASCII host is an error with the message above, and
  discovery treats it as not answering;
- a server URL with a non-ASCII host (`pair`, `/pair`) gets no link in the TUI, and in the CLI
  keeps the `<url>/auth/connect/<code>` fallback;
- an ACP resource or link whose URI has a non-ASCII host is treated as an unparsable URI: its
  name comes from the last path segment, and an embedded text resource is labelled with the URI;
- an OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`) with a non-ASCII host exports nothing.

The stub also stops `url` from checking UTS 46 rules on punycode labels, so a malformed `xn--`
label parses where TypeScript rejects it; the server or DNS rejects it later.

Reason: decision O-58 (E1). Full IDNA pulls ICU4X into the build, 21 crates with 2 build scripts
and 4 proc macros, for host names that a user can write in punycode.
