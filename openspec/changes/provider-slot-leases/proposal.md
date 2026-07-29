# Stop concurrent instances double-booking the same provider slot

## Why

Provider reservations are per-process and invisible to everyone else.

`placement.ts` holds reservations in memory with a TTL so that concurrent picks *within
one process* don't double-book a host. On 2026-07-25 four opencode processes were running
on this machine simultaneously. Each had its own reservation map. Nothing stopped two of
them from both observing z4 as idle — which it was, `in_flight: 0, slots_total: 1` — and
both dispatching a subagent onto its single slot. The second request queues behind the
first, which is exactly the outcome placement exists to avoid.

This is the concrete form of "can I claim this provider as my sub-agent, and does that
mean it can't take other calls". Today the answer is: you can decide to claim it, and
nobody else can hear you say so.

**A correction worth stating plainly.** The shared SQLite file is tempting as the
coordination point — every instance on this machine has the same inode open and SQLite
gives real cross-process ACID. But it is a *local file*. m5 also runs opencode-skein and
does not share it. So the shared database solves same-host contention completely and
cross-host contention not at all. Any design that treats it as the fleet-wide answer is
wrong.

**What already exists cross-host.** skein's claim registry is genuinely distributed —
entries carry `host`, `pid`, `age_secs`, and it already expires them. But its claims are
scoped to changes and roles, not provider slots. The mechanism is right; the noun is
missing.

## What Changes

### 1. Leases, not locks

A lease is a short-lived, TTL-bounded declaration of intent to use one slot on one
provider. Leases expire on their own; a crashed holder cannot wedge a provider.

Leases are deliberately **advisory**. Perfect distributed mutual exclusion is expensive,
and the cost of losing a race here is low — a request queues behind another. It does not
corrupt anything. Paying for consensus to avoid a queue would be the wrong trade.

### 2. Verify immediately before dispatch

The lease narrows the race window; it does not close it. Directly before dispatching,
placement re-reads live capacity (`provider-capacity-truth`) and abandons the placement if
the slot is no longer free, falling back to the existing inherit-parent path.

This makes correctness depend on an observable fact rather than on a distributed
agreement, which is the only way to get it cheaply. The lease turns a likely collision
into a rare one; the verify turns a rare collision into a fallback instead of a queue.

### 3. Tiered store, honest about reach

| scope | store | guarantee |
|---|---|---|
| same host | shared SQLite, unique constraint on active lease per provider slot | exact mutual exclusion |
| cross host | skein claim registry when reachable | best effort, TTL-expired |
| neither | in-memory, current behaviour | per-process only |

Each tier degrades to the one below without failing. An instance with no skein and no
peers behaves exactly as it does today. **opencode-skein must remain fully functional
standalone** — skein makes coordination better, never mandatory.

### 4. Leases are observable

Active leases are exposed alongside capacity, so a human or peer can see not just that a
slot is busy but who intends to use it and for how long. A slot that is free but leased is
a different situation from one that is simply free, and the fleet view should say so.

## Capabilities

### New Capabilities
- `provider-leases`: TTL-bounded, advisory, observable claims on provider serving slots,
  with a tiered store that degrades safely.

## Dependencies

- `provider-capacity-truth` — verify-before-dispatch needs a trustworthy free-slot reading.
  Without it, verification would consult GPU utilisation and refuse to place on idle hosts.

## Non-Goals

- No consensus protocol, no leader election, no distributed lock manager. The failure mode
  being prevented is a queued request.
- Not making skein a required dependency.
- Not leasing anything other than provider slots — file locks and repo/worktree contention
  between instances are a separate problem.
- Not changing placement's scoring policy; only adding a lease acquisition and a
  pre-dispatch check around the existing decision.

## Impact

- Modified: `packages/opencode/src/local/placement.ts` (reservations become leases;
  pre-dispatch verification), plus a lease store with the three tiers.
- New: lease table in the shared database; skein claim adapter behind an interface so the
  cross-host tier is swappable.
- Behaviour is unchanged for a single instance with no peers — the common case must not
  regress or slow down.
