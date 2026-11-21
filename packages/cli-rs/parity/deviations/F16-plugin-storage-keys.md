# F16: a plugin's dotted storage key has a name of its own

## TypeScript

A plugin's stored key `key` lives in `<state>/<channel>/tui/plugin.{id}.{key}.json`. Plugin IDs and keys may hold dots,
so two plugins can name one file: `acme` with the key `cloud.token` and `acme.cloud` with the key `token` read and
write the same value.

## Rust

- A key with no dot keeps TS's name, so a TS and a Rust client share it as before.
- A key with a dot lives in `plugin.{id}..{key}.json`. No pair of an ID and a key shares a name with another
  (`crates/plugin/src/storage.rs`).
- What TS stored under a dotted key is not read: its name `plugin.{id}.{key}` is also another plugin's dot-free key's
  (`acme`'s `cloud.token` is `acme.cloud`'s `token`), so reading it would hand one plugin the other's value. A TS
  client and a Rust client keep a dotted key apart.
- An ID or a key that starts or ends with a dot, holds two in a row, or holds a character other than letters, digits,
  `.`, `_` and `-` cannot name storage: the read or write is refused.
- A plugin declares 128 keys at most, and a stored value is 256 KiB of JSON at most. TS bounds neither: opencodebar's
  price list of 1 MB and prompt-search's index of every prompt (330 KB at 900 sessions) are refused, the write's
  promise rejects, and the plugin goes on (CT-36).

## Reason

A plugin must not read or overwrite another plugin's storage by choosing its ID or key (review carbon-6), on the
native and the pipe carriers alike. The host also keeps what it read of each key, so what a plugin may make it keep is
bounded.
