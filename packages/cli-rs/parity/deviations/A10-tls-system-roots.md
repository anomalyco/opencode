# A10: TLS trusts the system root store

TypeScript: Bun's `fetch` and `WebSocket` verify HTTPS and `wss://` servers against the Mozilla root
certificates bundled with Bun, plus `NODE_EXTRA_CA_CERTS`. Bun's `fetch` speaks HTTP/1.1.

Rust: every HTTPS request and `wss://` socket uses one rustls configuration
(`crates/api/src/transport.rs`, `tls_config`). It verifies certificates with
`rustls-platform-verifier`, which reads the system root store on the first certificate check
(on Linux, the CA bundle that `rustls-native-certs` finds, including `SSL_CERT_FILE`). The crypto
provider is ring, and ALPN offers `http/1.1` only, as Bun's fetch does.

Differences:

- A server whose certificate chains to a private CA that is installed in the system store is
  trusted by the Rust client and rejected by Bun. A server that chains only to a root that Bun
  bundles but the system lacks is rejected by the Rust client.
- `NODE_EXTRA_CA_CERTS` has no effect on the Rust client. Add the CA to the system store or point
  `SSL_CERT_FILE` at a bundle that contains it.
- A system without a CA bundle fails the first HTTPS or `wss://` handshake with "No CA certificates
  were loaded from the system". Plain `http://` and `ws://`, such as the managed service, never read
  the roots.
- ring offers no post-quantum key exchange (X25519MLKEM768). Servers negotiate X25519 instead.

Reason: decision O-50 (D2). One root store for HTTPS and `wss://`, so a socket never fails where
the HTTP request to the same server works, and ring instead of aws-lc removes a C build and about
3 MB from the binary.
