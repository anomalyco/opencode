# A01: lone surrogate escapes in server JSON

**TypeScript.** `JSON.parse` keeps a lone UTF-16 surrogate escape (`"\ud83d"`) as a lone surrogate. The server's
`JSON.stringify` writes one for any string cut inside a surrogate pair, such as a truncated search excerpt. The
terminal shows it as a broken character.

**Rust.** A response body or event payload with a lone surrogate escape reads it as U+FFFD (`opencode_api_types::de::well_formed`).
Every other character reads the same.

**Reason.** Rust strings cannot hold a lone surrogate, and serde_json rejects one. Without the replacement the whole
response or event failed to decode, and the event stream reconnected.
