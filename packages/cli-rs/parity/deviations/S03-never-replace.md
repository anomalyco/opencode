# S03: the Rust client never replaces a running service

**TypeScript.** `Service.ensure` (`packages/client/src/effect/service.ts:45-127`) replaces a
service whose version does not match (`decide` returns `replace`, then `stop` with a PTY handoff),
and stops a registered service that times out three probes in a row before it starts another.

**Rust.** `ensure` (`crates/service/src/ensure.rs`) passes no version requirement, so a service of
any version is used. A service that keeps timing out is left running, and `ensure` fails with
"Background service at <url> (pid <pid>) is not responding. Stop it with `opencode service stop`,
or pass --server." Only an unresponsive contender this `ensure` call started itself is stopped, as
TS does. The service is started only when discovery finds none (`docs/F.9.md`).

**Reason.** User decisions Q2 ("this is a client we build and ship, not a server") and Q3 ("it
should work with the running server"), and the run notes of F.9: the client never replaces or stops
a service it did not start. A Rust client is always another version than the TS service, so
replacing on a mismatch would replace the user's service on every start.
