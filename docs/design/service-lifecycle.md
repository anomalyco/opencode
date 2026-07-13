# Service Lifecycle: Update, Election, and Reconnect

Design for how the managed V2 service restarts, how exactly one server wins,
and what clients do while it happens.

Status: proposed
Incident: [#36688](https://github.com/anomalyco/opencode/issues/36688)

## Context

The V2 CLI runs a long-lived shared service (`serve --service`) that all TUIs
and API clients connect to. The service auto-updates the on-disk package in the
background. Today, a version-mismatched client connecting triggers the running
server to tear itself down, and every open TUI's reconnect loop independently
races to spawn a replacement.

Incident #36688 showed the failure modes of this design in one 45-second
window:

- The old server tore down on mismatch; ~10 contenders spawned in two waves.
- The first winner spent ~20s cold-booting location graphs while invisible
  (no registration, nothing answering health), so the second wave concluded
  there was no server and displaced it mid-boot: a double-bounce.
- A freshly launched TUI exhausted its reconnect budget (3 attempts, ~16s)
  during the window and crashed with an unhandled transport defect.
- A losing contender from the previous day was still alive, unregistered,
  holding ~1GB RSS.

## Goals

- A service restart, updates included, costs open clients a brief, honest
  "updating" state and nothing else.
- No client crashes from server unavailability, ever.
- At most one server bounce per restart cause.
- No leaked service processes.
- In-flight interactive state (permissions, questions, tool calls) survives
  restarts via a defined recovery path.

## Non-goals

- Cross-version protocol compatibility (client tolerating an older server).
  Gated on protocol versioning/negotiation work; see Decision 1.
- Cold-boot load management for many locations (boot concurrency limits,
  interaction priority, boot-free cheap surface). Deferred follow-up.
- Multi-machine or clustered service placement.

## Target UX

A user with several open TUIs pushes an update (or the service self-updates):

1. Each open TUI shows a single calm status line, e.g. `Updating to
   v0.0.0-next-15427...`, driven by real server status, not retry counters.
2. Within a couple of seconds the successor is answering; TUIs resume where
   they were. Sessions that were mid-step resume; a pending permission or
   question is re-asked.
3. A TUI launched during the window waits on the same status line instead of
   erroring. It only hard-fails with a message that names an actionable cause.

## Decisions

### 1. Restart trigger: client-triggered on mismatch now, idle self-restart layered on top

The TUI and the generated protocol client are version-locked to the server
protocol, with no cross-version compatibility guarantee. A newer client cannot
safely talk to an older server, so version-mismatch teardown remains the
correctness mechanism: a connecting client that detects a stale server
initiates a restart.

Layered on top, the server that has downloaded an update watches for an idle
window (no active drains, no pending interactions, no busy sessions) and
restarts itself proactively. This makes the mismatch-triggered path rare
rather than the only path, which matters most while updates ship many times
per day.

Full skew tolerance ("new client reads from old server until it restarts") is
explicitly deferred until the protocol has a compatibility window or version
negotiation.

### 2. Successor spawning: the initiator spawns exactly one

Whoever causes a restart owns producing the replacement:

- On version mismatch, the triggering client spawns exactly one new-version
  `serve --service` process.
- On idle self-restart, the exiting server spawns its successor before exiting.

All other clients never spawn. They reconnect with jittered backoff. Client-
side spawning survives only as the frozen-owner fallback (Decision 7).

This removes the thundering herd of contender processes and the class of bugs
that come with it (races, displacement, leaked losers).

### 3. Successor visibility: register first, boot lazily

The winner's first act after acquiring ownership is binding the service port
and answering health:

- Health reports `{ status: "starting" }` immediately, flipping to healthy
  when the server is ready to serve normally.
- Requests arriving during startup are held briefly or answered with a
  retryable "starting" status.
- Location graphs are not eagerly rebooted; they boot on demand as clients
  ask for them (existing `LocationServiceMap` behavior).

Time-to-visible drops from ~20s (full boot) to under a second. This gives
clients a crisp two-signal contract:

- Connected but `starting`: wait quietly.
- No registration at all: start the fallback timer (Decision 7).

The incident's double-bounce is impossible under this ordering: there is no
window where a winner exists but cannot be observed.

### 4. Client reconnect: transport failure is never terminal

Transport failure carries no diagnosis, so it never terminates a client by
itself.

- An already-open TUI reconnects indefinitely with jittered backoff. Its
  screen is state-aware, driven by the health contract from Decision 3:
  `Updating to vX...` when the registration says starting, `Waiting for
  server...` when unregistered. Never a retry counter, never a raw transport
  error name.
- A fresh launch waits the same way, and may act as initiator (Decision 1) or
  fallback spawner (Decision 7).
- Hard exit is reserved for diagnosable causes: the server process this
  client spawned exited nonzero (surface its stderr), the port is held by a
  foreign process, configuration is invalid.
- The transport error domain is handled exhaustively at the TUI run boundary
  (`packages/cli/src/commands/handlers/default.ts`, `packages/tui/src/app.tsx`).
  No escaped defects; an unexpected failure still exits with a clean message.

### 5. In-flight state: cancel-and-resume is the universal invariant

Crashes exist regardless of update policy, so every in-flight interaction must
have a defined cancel-and-resume path. Restart behavior is a special case of
crash recovery, not its own mechanism.

- In-flight tool calls are canceled; the resumed runner re-executes them at
  the durable step boundary.
- Pending permission requests and question forms are canceled; the re-run
  step re-asks them.
- A foreground sub-agent's parent tool call is re-invoked on resume. The
  child session is durable, so re-invocation reconciles against the existing
  child session rather than redoing completed work where possible.

Follow-up: make pending permissions/questions durable rows so they survive
restarts without re-asking. They are small, schema-friendly values and are the
most user-painful cancels.

Independent bug (not a restart design choice): background sub-agent completion
must be recorded as a durable event the parent session consumes on wake.
Today the parent misses the completion whenever it is not running when the
child finishes, even without any restart involved.

### 6. Cold-boot herd: deferred

When many clients reconnect at once, demand-driven location boot still causes
a herd of concurrent cold boots. Bounding boot concurrency, prioritizing
locations with active user interaction, and making the cheap surface (health,
reconnect handshake, session metadata) boot-free are a follow-up. Nothing in
this design precludes them.

### 7. Election: the port is the lock

Exclusive bind on the service port is the only mutex. There is no separate
lock file: nothing to leak past process death, no second source of truth to
disagree with the port.

- A contender that fails to bind concludes someone else won, logs it, and
  exits immediately. Losers never linger.
- Displacement is structurally impossible: a bound port cannot be bound again.
- Frozen owner escalation: if a bound port fails health checks for M seconds,
  a fallback contender verifies the registered PID is an opencode service
  binary, kills it, and retries the bind. This is the only destructive action
  in the scheme and is logged loudly.
- Fallback contenders re-check the registration immediately before spawning
  and stagger with jitter, so even the rare fallback path seldom produces
  more than one loser.

## Failure-mode walkthroughs

Update while TUIs are open (the incident scenario):

1. Server downloads vNext in the background (existing behavior).
2. Either the server finds an idle window and self-restarts (Decision 1
   layer), or a new vNext client connects, detects mismatch, and initiates.
3. The initiator spawns exactly one successor (Decision 2). The old server
   drains and exits; in-flight interactions cancel (Decision 5).
4. The successor binds the port and registers within ~1s, answering
   `starting` (Decision 3).
5. Open TUIs show `Updating to vNext...` and resume when healthy
   (Decision 4). Canceled steps resume; forms re-ask.

Server crash:

1. Clients see connection loss with no registration; fallback timers start.
2. After the pre-check and jitter, one client binds the port and becomes the
   server; any other contender fails to bind and exits (Decision 7).
3. Recovery of in-flight state follows the same cancel-and-resume invariant.

Wedged server (process alive, unresponsive):

1. Port stays bound; health fails for M seconds.
2. A fallback contender verifies the PID, kills it, binds, and registers.

## Incident mapping

| #36688 problem | Addressed by |
| --- | --- |
| TUI crash after 3 reconnect attempts | Decision 4 |
| ~45s window with no answering server | Decisions 2, 3 |
| Double-bounce: mid-boot winner displaced | Decisions 3, 7 |
| Leaked losing contender (1GB RSS, day-old) | Decision 7 |
| Every TUI bounces on each daily push | Decision 1 (idle layer) |

## Sequencing

1. Decision 4: exhaustive transport handling and indefinite state-aware
   reconnect. Client-side only; stops the crashes immediately.
2. Decisions 7 and 3: port-as-lock, register-first, `starting` health status.
   Kills the double-bounce and process leaks.
3. Decision 2: initiator-spawns-one; demote client spawn to fallback.
4. Decision 5: cancel-and-resume audit across permissions, questions, tool
   calls, sub-agents; durable background-completion event.
5. Decision 1 layer: idle self-restart after background update.
6. Follow-ups: durable permission/question forms, cold-boot load management,
   protocol compatibility for true skew tolerance.

## Open questions

- What are good values for the fallback timer (no registration for N seconds)
  and the frozen-owner escalation (unhealthy bind for M seconds)? N must
  comfortably exceed successor spawn+bind time; M must exceed the slowest
  acceptable startup hold.
- How does `starting` interact with request holding: hold with a deadline,
  or immediately return a retryable status and let clients poll?
- Does the idle self-restart need a user-visible opt-out (`autoupdate`
  config already exists for the download side)?
- Exact verification rule before the frozen-owner kill (binary path check,
  registration PID match, or both).
