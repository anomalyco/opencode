# S03: the Rust client replaces a running service only on a version mismatch, as the TUI asks

**TypeScript.** `Service.ensure` (`packages/client/src/effect/service.ts:45-127`) replaces a
service whose version does not match (`decide` returns `replace`, then `stop` with a PTY handoff),
and stops a registered service that times out three probes in a row before it starts another. The TUI
and `mini` ask for a match (`mismatch: "replace"`, `commands/handlers/default.ts:35-52`); the other
commands use any version.

**Rust.** The TUI and `mini` restart a service of another version as TS's do (O-167,
`connect::Options::replace`, `docs/architecture.md`): same trigger, same message (`Restarting background server
(version mismatch)...` in the TUI, nothing in `mini`), same failure (the start's error). Four
differences remain:

- Only a service in the client's own channel's registration is restarted, as TS reads only that one;
  one discovery found in another channel's (O-21) is used as before.
- The client asks the resolved TS binary's version first, and does not restart a service with a
  binary of that service's own version: TS restarts on itself, which is the client's version by
  construction, while the Rust client may run another TS binary (`OPENCODE_TS_BIN`, `opencode` on
  `PATH` behind a development build) and would otherwise restart on every start.
- A `local` build (no `OPENCODE_VERSION`) restarts only in channel `local`. TS's `local` build registers in
  `service-local.json` and never sees the shared service; this client defaults to channel `latest` and shares
  `service.json`, where no TS binary reports `local`, so it uses that service of any version and logs the mismatch.
- A service of another version that is still starting is waited for, then restarted; TS replaces it at
  once.

Every other command uses a service of any version (`ensure` gets no version requirement). A service
that keeps timing out is left running, and `ensure` fails with "Background service at <url> (pid
<pid>) is not responding. Stop it with `opencode service stop`, or pass --server." Only an unresponsive
contender this `ensure` call started itself, or a registration whose pid no longer runs, is stopped and
replaced, as TS does.

**Reason.** User decisions Q2 ("this is a client we build and ship, not a server") and Q3 ("it
should work with the running server"), and the run notes of F.9: the client never replaces or stops
a service it did not start. O-167 reverses that for a version mismatch: with the server bundled beside
the client (bundle-server) both carry one version, so a mismatch means an upgrade left the old service
running, and TS's client restarts it.
