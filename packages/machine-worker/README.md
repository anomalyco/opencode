# opencode-machine-worker

Sans-I/O protocol library for the OpenCode machine worker: decodes `ocjoin_` join strings, runs the connecting side of the `opencode-link-v1` Noise XX authenticated handshake, and encodes/reassembles framed Noise transport messages with per-direction rekeying.

## Checks

Run from `packages/machine-worker`:

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

## Next

Invariants for the transport/binary slice built on top of this crate:

- **Retain the join secret until `read_welcome` succeeds.** `Dial` consumes the `Secret` passed in `DialOptions`, and a lost welcome after pairing requires retrying the handshake with the same secret; the caller must keep its own copy and drop it only once `read_welcome` returns `Ok(Session)`.
- **Drop the `Session` on any partial socket write.** `Session::encode` encrypts all frames for a message and advances the Noise nonce and rekey counter for every frame it returns. If writing those frames to the underlying socket fails partway through, the session cannot recover and must be dropped.
