# Idle Session Compaction

Status: **Draft** (revised after independent review).

## Decision

Open Sessions compact while idle, shortly before their provider prompt cache expires. A process-local server scheduler admits an ordinary compaction control item when the Session's cache anchor approaches `TTL − fire margin`, the cache is still warm, and the context is large enough. Interest is expressed by client presence leases — "this Session is open in a tab" — which survive frozen or killed clients. The mechanism never compacts a cold cache, never compacts a Session without a live presence lease, and never absorbs an explicit manual compaction into an idle one.

The behavior is gated by the `idle_compaction` flag; the only tuning knob is `compaction.idle.min_tokens`. Compaction reason `"idle"` joins the event reasons `auto | manual` (`overflow` remains a Trigger-only reason that folds into `auto`).

## Context

Prompt cache entries expire after a provider TTL (Anthropic: five minutes by default, one hour opt-in); every cache hit resets the timer. A return after expiry reprocesses the full history at full input price and latency. Compaction while the cache is warm reads the cached prefix cheaply and replaces history with a short summary, so the return pays only for the summary. Claude Code shipped this as idle compaction; its rollout (anthropics/claude-code#105775) showed the failure mode to avoid: default-on, lossy compaction of sessions the user still needed, without consent or a size floor.

Core already owns the pieces: compaction control items with one-pending-per-Session dedup (`session/inbox.ts`), context estimation and due checks (`session/compaction.ts`), cache-lifetime awareness (`cacheLifetime`, default five minutes, `CACHE_MARGIN` 30 seconds, used by `precompute`), and a per-session timer precedent in the warming plugin (`plugin/warming.ts`).

What Core cannot see is which Sessions are open in client tabs. Tab state is client-local (app `useTabs`, TUI `useSessionTabs`), and clients freeze (backgrounded PWA) or die (evicted from memory) exactly in the scenarios this feature targets. The decision must therefore live on the server, and presence must not require the client to be alive at decision time.

The cache's true clock is the **anchor**: the newest assistant message with a measured prompt, whose request last wrote the cached prefix. `time_idle` is only a proxy and is always at least one millisecond newer than the anchor (`projector.ts` advances it monotonically at the terminal event). Timers therefore arm from the anchor, not from `time_idle`; `time_idle` serves as the epoch identity carried in the idle item.

## Presence Leases

`POST /api/experimental/session/presence` accepts `Session.PresenceReport`: `{ client, sessions }`, the full set of Session IDs open in tabs of one client instance. `client` is an opaque per-instance identifier (a persisted UUID). Experimental: may change without compatibility guarantees.

- The server keeps a process-local registry `sessionID → client → lease expiry`. A report replaces that client's set: Sessions absent from it lose that client's lease. Each report refreshes the lease (default two hours).
- A Session is present while any client's lease is unexpired. Devices union; closing a tab on one device does not drop another device's lease.
- Presence is ephemeral interest, not an irreducible fact: it is never published to the event journal and never persisted.
- Clients report on tab-set change, periodically while running, and on reconnect. A frozen or evicted client stops reporting; its leases ride out the cache window and then expire. No close beacon: a lease that outlives the user's interest costs at most one warm compaction per idle epoch, bounded by the size floor, which does not justify a `pagehide` beacon that cannot carry server authorization.
- The two-hour default outlives the longest supported cache TTL (one hour) plus the fire margin and report cadence, so a client frozen just after a report still holds a lease at fire time.
- Unknown Session IDs and archived Sessions are ignored (stale client tabs; archiving is an explicit "work is done" signal). Registration never wakes a Session.

## Scheduler

A process-local, Session-ID-keyed fiber map (the warming pattern). Like `SessionExecution`, the scheduler discovers placement through `SessionStore` and `LocationServiceMap` when it acts; no layer above it takes a Session ID. Active-execution checks are process-local, like the rest of Session Core before clustering.

- A timer is armed when an execution reaches a terminal event — except interruption with reason `shutdown`, which preserves the execution claim for startup recovery — and when presence is registered for an idle Session. It is cancelled on new execution, on loss of the last lease, and on `session.deleted`.
- The timer fires at `anchor + TTL − FIRE_MARGIN`. `FIRE_MARGIN` is a constant 90 seconds; `WARM_MARGIN` reuses `CACHE_MARGIN` (30 seconds); the invariant `FIRE_MARGIN > WARM_MARGIN` keeps the fire moment inside the warm window. TTL resolves from the Session's selected model (`cache.ttl`); a Session without a measured anchor, or whose model cannot be resolved, arms nothing.
- The anchor and the model selection are durable, so presence registration after a server restart re-arms correctly without a startup scan.
- Cheap process-local checks (flag, lease) run before any placement-scoped history or model load, so a terminal event for an uninteresting Session costs no I/O.
- At fire, every firing law is re-checked; a stale timer consumes itself without admitting anything.

### Firing laws

All must hold, at fire and again at delivery:

1. Flag `idle_compaction` enabled, and automatic compaction (`compaction.auto`) enabled — checked before admission, so a disabled configuration writes no durable events.
2. A presence lease is live.
3. The Session is idle and settled: no active execution, no pending input, no staged revert, not archived.
4. The cache is warm: the anchor is no older than `TTL − WARM_MARGIN` (the `precompute` rule). A cold cache is never compacted by this mechanism.
5. The context estimate is at least `compaction.idle.min_tokens` (default 50,000).
6. Once per idle epoch: no completed or failed compaction since the latest user input.
7. The Session is not a subagent (`parentID`); the resolved model has an explicit `cache.ttl` and is not native-compaction; the resolved warming setting for the model is off.

The cacheable predicate is deliberately conservative: only an explicit `cache.ttl` gives a known cache clock. Implicitly caching providers without catalog TTL data are out of scope until the catalog describes them; compacting them on a guessed clock would be paid and lossy without a known benefit.

Warming and idle compaction are alternative strategies for the same cost: keep-alive pings versus one summary. The predicate is "warming configured for the resolved model" (top-level `warming` or the model's `cache.warming`), not "warming loop active": the plugin's loop state is private, and warming pings are generate requests that do not move the anchor. A warming-configured Session is therefore excluded even after the warming window expires; its cache then dies as it does today, with no regression. Handoff after the window would require a shared warming-state registry and is deferred.

### Execution

The scheduler calls `admitCompaction` and `execution.wake` directly, not the `Session.compact` facade, which commits a staged revert — idle compaction must not commit a revert without the user's will.

- The idle item's payload carries `reason: "idle"` and the `time_idle` observed at admission (the epoch anchor). Delivery is `"queue"`, so returning user input (steer) promotes first.
- Dedup is per reason class: a pending idle item coalesces with another idle admission; a manual admission is never absorbed by an idle item. Under the Session's serialization, manual admission cancels a pending idle item and admits the manual steer.
- At delivery of an idle item, the runner loads history and re-checks the firing laws plus epoch identity: the current `time_idle` must equal the payload's, and no user or synthetic input may have arrived since enqueue. This runs **before** `Compaction.Started` is published. A stale item is consumed with `InboxDelivered` alone — no started marker, no failed marker, no transcript message. This covers the returning-steer case, the stranded-after-restart case, and any law that changed while the item waited.
- A usable held `precompute` summary is applied without a model call, waiting for an in-flight summary fiber as `usePrecomputed` does today.
- Failure publishes `session.compaction.failed` with reason `"idle"` and is terminal for the epoch: law 6 counts failed compactions as well as completed ones, so even a fast provider failure that leaves the anchor warm cannot loop. There is no explicit retry. The user may see a failed marker they did not order; that is accepted as visibility of spent tokens.

`session.compaction.started/ended` carry reason `"idle"`. Client labeling of the marker is a follow-up change.

## Surfaces

The change is not confined to a new module:

- `CompactionPayload` (today an empty struct) gains `reason` and the epoch anchor; `Trigger` and `compact()` gain the idle reason, including the hardcoded `auto` in the started event and the non-manual reason mapping.
- Runner control-item delivery hardcodes `reason: "manual"`; idle delivery re-checks laws before publishing `Compaction.Started`.
- Wire literals for compaction reasons in `schema/src/session-event.ts` and `schema/src/session-message.ts` gain `"idle"`.
- Protocol gains `experimental.session.presence`; the SDK is regenerated (`bun run generate` from `packages/client`).
- Core gains the presence registry, the scheduler, the flag, and `compaction.idle.min_tokens`.
- App and TUI report presence; marker labeling follows separately.

## Alternatives Considered

- **Client-side timer calling `session.compact`.** Simplest, and "open in a tab" is exact. Rejected: the timer dies exactly when the feature matters — a backgrounded PWA freezes JS, an evicted PWA loses its process, and browser throttling makes the five-minute window marginal.
- **Liveness heartbeat presence (short expiry).** Rejected: a frozen or evicted client loses presence and the server skips compaction in the target scenario. Leases encode open tabs, not client liveness.
- **Plugin on `experimental.idle` plus a presence API.** The idle hook is the existing "Session is about to sleep" point, and the warming plugin proves the fiber-map pattern. Rejected as the home: delivery-time re-checks, the payload reason, and manual-vs-idle dedup require runner and inbox changes regardless, and the scheduler must also arm on presence registration, which the idle hook never sees. Core owns the mechanism; the hook stays available to plugins.
- **Overloading `session.view`.** Rejected: a durable watermark for unread state; presence reports would spam the journal with derivable, ephemeral interest.
- **Durable `Schedule` rows per idle Session.** Rejected: durable writes and leader election for a timer whose interest input is process-local and whose anchor is already durable. Re-arm from presence covers restart.
- **Compact on return (cold).** Not included: it does the same full reprocess the return would pay, plus a summary, and loses context without the warm-cache saving. May be considered separately as an explicit user choice.

## Consequences

- At most one warm compaction per idle epoch per present Session; a user who never returns wastes one cached-prefix read plus a summary, bounded by the size floor.
- Presence is interest, not attention: a TUI left open in tmux holds a lease indefinitely, so a large idle Session compacts while the user may simply be reading nearby output. The floor, once-per-epoch law, and release-off flag bound the cost; attention-aware presence is deferred.
- A sleeping machine with a local server runs nothing; on wake the warmth law prevents a wasted cold compaction. The feature targets a live server with an absent client: remote servers, backgrounded PWAs, minimized desktop windows.
- Presence is process-local; leases do not survive server restart and clients re-register on reconnect. Stranded idle items are consumed without compaction by the epoch and warmth checks.
- Warming-configured and implicitly caching models are excluded; the behavior is flag-gated and off in releases until proven.

## Verification

Behavioral scenarios, written as tests before the implementation:

Presence registry:

- a report creates and refreshes leases; a report without a Session drops that client's lease;
- two clients union; one client's close leaves the other device's lease;
- lease expiry removes presence; unknown and archived Session IDs are ignored;
- registration writes no durable events and wakes no Session.

Scheduler:

- arms on an execution terminal event; fires at `anchor + TTL − FIRE_MARGIN` under a controlled clock;
- interruption with reason `shutdown` does not arm; a Session without a measured anchor does not arm;
- new execution, last-lease loss, and `session.deleted` cancel the timer;
- presence registration after restart re-arms from the durable anchor;
- absent presence never fires; flag off arms nothing and admits nothing;
- a one-hour `cache.ttl` fires inside the lease window; an unresolvable model arms nothing.

Firing laws:

- a cold anchor skips, including an anchor exactly at the warm boundary;
- below-floor context skips; a completed compaction this epoch skips;
- subagent, missing explicit `cache.ttl`, native compaction, and warming-configured Sessions skip (warming both active and past its window);
- staged revert, archived Session, pending input, and `compaction.auto` off skip before admission.

Delivery and epoch:

- a returning steer after fire promotes first; the idle item is then consumed with `InboxDelivered` alone — no `Compaction.Started`, no marker — and the next boundary compacts nothing;
- a stranded idle item after restart is consumed without compaction at the next wake;
- a manual `/compact` with a pending idle item cancels the idle item and runs as a manual steer;
- a successful idle compaction re-arms the timer and the next fire skips: at most one compaction per epoch, no loops;
- a held precomputed summary applies without a model call, including one still in flight at delivery;
- failure publishes `compaction.failed` with reason `"idle"`, visible to the user, and does not retry within the epoch, including a fast failure that leaves the anchor warm;
- `compaction.started/ended` carry reason `"idle"`.

Protocol:

- `experimental.session.presence` path and identifier match (existing experimental-identifiers suite).
