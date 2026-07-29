# Schedule on measured provider capacity instead of GPU utilisation

## Why

The fleet scheduler refuses work on idle machines because it reads the wrong number.

Measured on 2026-07-26, the same instant, across three hosts:

| host | `gpu_util_pct` | `inference` | verdict |
|---|---|---|---|
| **z4** | **85%** | `{busy: false, in_flight: 0, slots_total: 1}` | **idle and free** |
| rocky | 99% | `{busy: true, in_flight: 1, slots_total: 1}` | genuinely serving |
| proxmox | 3% | `{busy: false, in_flight: 0, slots_total: 1}` | idle |

skein's `get_providers_status` reports `gpu_util_pct` and does not expose the `inference`
block at all. So z4 — a 48 GB host with the requested model already resident and zero
requests in flight — reads as 85% busy and gets skipped. rocky's 99% happens to agree
with reality, which is what makes the bug hard to notice: the proxy is right often enough
to look sound.

The cause is that GPU utilisation is not a queue-depth signal. On z4's AMD W7800 the
model is pinned at `ttl 0` and never unloads, so a resident-but-idle model reads high.
Utilisation measures whether the silicon is doing something; it cannot distinguish "busy
serving a request" from "holding weights". Only the server knows its own queue.

opencode-skein already reads the right signal — `placement.ts` prefers
`inference.busy` and falls back to windowed GPU util only for hosts too old to serve it
(llama-skein ≥ `04b2ce7`). Its `freeSlots()` already computes
`slots_total - in_flight - reserved` and is already tested for multi-slot hosts. The
knowledge exists in one half of the ecosystem and not the other.

This is the cheapest available fix to the complaint that the fleet "assumes a provider
should be able to work as this agent, but then it is unresponsive or not ready". No new
infrastructure, no broker, no protocol.

## What Changes

### 1. Publish capacity as a first-class fact

opencode-skein exposes a normalised capacity snapshot per known provider over its
existing HTTP API: `slots_total`, `in_flight`, `free_slots`, `busy`, `loaded_model`, and
`signal: "exact" | "inferred"` recording which source produced it.

`signal` is the load-bearing field. A consumer must be able to tell a measured queue
depth from a guess derived from GPU utilisation, and weight its decisions accordingly.

### 2. Never let an inferred signal mask an exact one

Where both are available the exact signal wins unconditionally. Where only GPU
utilisation is available the snapshot is marked `inferred` and its `free_slots` is
advisory.

### 3. Report staleness

Every snapshot carries the age of the probe that produced it. A capacity reading with no
age cannot be reasoned about — a consumer has no way to tell live data from a cached
answer taken before the host went down.

## Capabilities

### New Capabilities
- `provider-capacity`: a normalised, provenance-tagged view of how much serving capacity
  each provider actually has free.

## Non-Goals

- Not changing `placement.ts`'s scoring policy — it already reads the right signal; this
  change exposes what it knows rather than altering how it chooses.
- Not reserving or leasing capacity. Knowing a slot is free is separate from claiming it;
  see `provider-slot-leases`.
- Not modifying skein. This change makes the correct signal *consumable*; adopting it on
  the skein side is a change in that repo.
- Not adding a push transport. Consumers poll the existing HTTP API.

## Impact

- New: capacity snapshot type and endpoint in `packages/opencode/src/local/`, backed by
  the existing `/api/hardware` probing in `mdns.ts` and the `freeSlots()` math in
  `placement.ts:66`.
- No behaviour change to existing placement decisions — the same inputs produce the same
  choices; they simply become observable.
