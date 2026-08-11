# Design: harden-local-provider-runtime

## D1 — fit fetch timeout: abort signal at the call site

**Chosen:** `fetchLocalModelFit(controlBase, signal?)` accepts an
`AbortSignal`; `discoverOpenAICompatibleModels` passes the same
`AbortController` it already uses for the `/models` fetch, so one 2s budget
covers both requests. Verified: the hey-api client forwards per-request
`signal` (`Options` → `RequestOptions extends Omit<RequestInit, …>`, spread
into `new Request(url, requestInit)` at `gen/client/client.gen.ts:81-87`), so
`client.getFitReport({ signal })` is the whole fix. Ordering note: the
`AbortController` must be created *before* `fitPromise` (today it is created
after); the existing `.finally(clearTimeout)` already runs after
`await fitPromise`, so the timer covers the fit fetch once shared.

**Alternatives considered:**
- *Regenerate the client with a timeout plugin* — touches generated code and
  the generator config for one call site; over-scoped.
- *Global fetch wrapper with default timeout* — affects streaming chat
  completions which legitimately run for minutes; too blunt.

**Why one shared budget:** discovery's contract is "answer quickly or degrade";
fit data is an enhancement on top of `/models`, never worth waiting longer for
than the model list itself.

## D2 — config write serialization: one in-process mutex, re-read inside

**Chosen:** a module-level `Semaphore.makeUnsafe(1)` with `withPermits(1)`
(the repo's established pattern — see `src/snapshot/index.ts:63-69`) in a
small shared helper `withGlobalConfigLock(effect)` used by
`syncLocalProviders`, `connect`, and `disconnect`. The critical section
re-reads `configSvc.getGlobal()` *inside* the lock, applies its mutation to
the fresh snapshot, then writes.

**Alternatives considered:**
- *Push a `modifyGlobal(fn)` API into Config.Service* — cleaner long-term, but
  Config.Service is upstream-shared code; keeping the lock in fork-owned files
  avoids a rebase hotspot.
- *File locking (flock)* — fixes multi-process too, but bun/platform
  portability and upstream drift make it a separate proposal.

**Invariant:** within one opencode process, provider-map read-modify-write
sequences are linearized; a connect that commits before sync's write starts is
visible to sync's read.

## D3 — sidebar poll: tag results with their origin

**Chosen:** the poll closure captures its `url`; before `setMem`, compare with
the effect's current url (same closure variable — if the effect re-ran, the
old closure's cleanup flag is set). Concretely: a `let cancelled = false` set
in `onCleanup`, checked before `setMem`; plus pass an `AbortController.signal`
to the fetch and abort in `onCleanup` so the socket is released promptly.

**Alternatives considered:**
- *Compare `state().baseURL` at resolve time* — races the signal read and
  couples the poll to the reactive graph; the cleanup flag is local and exact.

**Why both flag and abort:** the flag guarantees correctness (no stale
`setMem`), the abort guarantees resource hygiene (no 30s zombie sockets to
dead hosts).
