# F.9: service lifecycle and spawn policy

`opencode-service` starts, waits for, and stops the TypeScript server. It ports
`packages/client/src/effect/service.ts` (`ensure`, `stop`), `service-contender.ts`, `pty-handoff.ts`,
and `packages/cli/src/services/standalone.ts`, with the policy below. User decisions Q2 and Q3 and
orchestrator decisions O-21 and O-22 apply.

## Policy

1. **Only when nothing is running.** The client starts a service only when discovery (F.6, all
   registrations in O-21 order) finds no ready, compatible service.
2. **Never replace, never stop a service it did not start.** No version requirement is ever passed
   to `decide`, so `Replace` cannot happen. A registered service that does not answer three probes
   in a row is left running, and `ensure` fails with a message that names it. The one exception is
   a registration whose pid is one of this `ensure` call's own contenders: that process was started
   by this client, so it is evicted as TS evicts any unresponsive service. `stop` is only for the
   explicit `service stop`, `restart`, and `set` commands (C.8).
3. **What it runs.** `ts_command`: `OPENCODE_TS_BIN` (one executable path), else `opencode` on
   `PATH`. The service is `<ts> serve --service`, the standalone server `<ts> serve --stdio --port 0`.
   The environment adds the service config's `env` (without `XDG_STATE_HOME`) and
   `OPENCODE_PTY_HANDOFF` from the sidecar, as TS does.
4. **Where it looks.** The TS binary picks its registration file from its own build channel, which
   the Rust client cannot know (the installed `opencode` here registers
   `service-oc-opentui-next.json`). `ensure` probes the client channel's file with the full TS
   semantics (wait, fail, timeouts). Once it has spawned a contender, each round where that file
   has no service also runs discovery over every registration and takes the first ready one.
   A started TS binary that finds its own incumbent exits 0, so this also covers a service that was
   still starting when the client looked.
5. **Contenders.** As TS: detached (own process group), stdin and stdout closed, an 8 KiB stderr
   tail; at most two alive; a startup failure is kept and reported once none is left; clean exits
   double the spawn delay up to the maximum; a registration that has not answered gets one spawn
   delay before a contender competes with it. A contender counts as finished when its stderr closes
   and it has exited (Node's `close`). The pool takes the clock as an argument so its tests need no
   processes or sleeps.
6. **Timing.** `Timing::default()` is `defaultEnsureTiming`: poll 25 ms, probe 2 s, spawn delay 5 s
   up to 30 s, deadline 120 s, stop poll 50 ms × 100.
7. **Standalone.** A private child with a random password in `OPENCODE_PASSWORD`, stdin kept open as
   its lease, stdout drained after the `{"url":…}` ready line, stderr inherited only under
   `OPENCODE_PRINT_LOGS=1`. Dropping the handle closes stdin and sends SIGTERM; `shutdown` also
   sends SIGKILL after 3 s.
8. **Connect.** `connect::resolve` uses standalone for `--standalone` or `disabled: true`; else
   discovery; else `ensure` (or standalone when `standalone_fallback`, the `run` mode with
   `autostart: false`). An `on_start` callback lets C.13 print "Starting background server...".

## Deviations

- S03: a version-mismatched or unresponsive service is never replaced
  (`parity/deviations/S03-never-replace.md`).
- A missing TS binary fails at once with the spawn error and the `OPENCODE_TS_BIN` hint; TS reports
  "Failed to start server" after the first poll.

## Proof

- The cases of `packages/client/test/service.test.ts` that apply, run against the same fake service
  (`packages/client/test/fixture/service.ts` under `bun`), with accelerated timing; replacement
  cases become "reuses" or "leaves running" cases.
- The cases of `service-contender-pool.test.ts` on fake attempts.
- Interop: in a temporary `HOME`, `XDG_*`, `OPENCODE_CONFIG_DIR`, and port, Rust `ensure` starts the
  TS CLI from source, and the TS CLI's `service status` in the same directories prints its URL.
