# Add free-tier cloud models as a probed, liveness-gated subagent placement pool

## Why

The fleet already has two placement pools: local llama-skein hosts (`ctx-aware-subagent-placement`,
`role-placement-policy`) and other live opencode-skein sessions (`session-peer-awareness`). llama-
skein hosts are frequently busy running their own opencode-skein sessions. The user's own
workaround, done manually today: open `/models`, search "free", pick a free-tier cloud provider,
send it a throwaway "hi" to check it actually responds, and if so use it as an extra subagent
target when the local fleet is saturated. This proposal makes that workflow a placement source
instead of a manual routine.

This must not repeat the exact failure class `subagent-notification-reliability` exists to fix or
`ctx-aware-subagent-placement` already hardened against for local hosts: a placement source that
looks available but silently isn't (rate-limited, cold, revoked) must never be selected, and the
parent must never block synchronously on an uncertain candidate. That is why this change depends
on `subagent-notification-reliability` landing first — a third, inherently less reliable
placement pool is a bad idea to add on top of a wake-up path that isn't already trustworthy.

## What Changes

### 1. Discover free-tier cloud providers via existing `/models` search

Reuse whatever provider/model catalog `/models` already queries to filter for a "free" tag or
zero-cost pricing metadata, rather than a hardcoded list — provider free tiers change.

### 2. Liveness handshake before eligibility, not before every placement

A discovered free-tier candidate is not placement-eligible until it passes a strict, cheap
handshake: send a short deterministic prompt (e.g. "Are you available? If so, answer exactly
'yes'.") and require an exact-match response within a short timeout. This mirrors exactly the
manual test the user already does. Handshake results are cached with a short TTL (candidates are
re-probed periodically, not on every placement decision, to avoid spending free-tier quota on
liveness checks alone) and a candidate that fails the handshake is not offered again until its
next probe window.

### 3. Extend placement scoring, don't replace it

`LocalPlacement.pick` (`placement.ts`) gains a lower-priority pool: local llama-skein hosts and
live opencode peers are preferred (residency/warmth already scores them highly); a free-tier
cloud candidate is only offered when no local/peer target is eligible, consistent with the
existing "silently moving a cloud parent's subagents onto local weights is a quality surprise, the
opposite is not" framing from `role-placement-policy`. A free-tier target is always cloud, so none
of the residency/VRAM-fit machinery applies to it — it is either liveness-passed and eligible, or
not offered.

### 4. Never select an unverified candidate

Selection MUST require a passed handshake within the current TTL window. A candidate whose probe
failed, is stale, or was never run MUST NOT be selected — including as a last-resort fallback.
Falling through to "no eligible target, run it yourself" is always safe; silently placing on an
unverified candidate is not.

## Non-Goals

- Not adding paid/metered cloud providers to placement — free-tier discovery only.
- Not building general cloud-provider health monitoring — the handshake is a placement gate, not
  observability infrastructure.
- Not the Claude-Code cross-session peer protocol (`claude-peer-protocol-spike`) — that is a
  different kind of peer entirely (another live agent session, not a model endpoint) and is
  explicitly out of scope here.

## Dependencies

- Depends on `subagent-notification-reliability` shipping first (see Why).
- Extends the scoring machinery from `ctx-aware-subagent-placement` and `role-placement-policy`;
  does not modify their local-host logic.

## Impact

- New: free-tier discovery + handshake probing, likely `packages/opencode/src/local/free-provider.ts`
  or alongside existing model catalog code (exact location TBD by whatever already backs `/models`
  search — investigate before creating a new module if one fits).
- Modified: `packages/opencode/src/local/placement.ts` (pool extension, eligibility gate),
  `packages/opencode/src/tool/task.ts` (candidate pool now includes free-tier when applicable).
