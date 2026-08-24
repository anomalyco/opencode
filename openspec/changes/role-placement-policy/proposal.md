# Let a role say where it wants to run, so a cloud parent can delegate locally

## Why

The most-wanted setup — a capable cloud model reasoning and planning with you, while
local agents do the tedious implementation — **does not work today**.

[placement.ts:260](packages/opencode/src/local/placement.ts:260):

```ts
// Only reroute when the parent itself runs locally: a cloud parent has no
// queue problem, and silently downgrading it to a local model would be a
// quality surprise.
if (!input.target && (!parentInfo || !baseURLOf(parentInfo))) return null
```

A cloud parent gets no placement at all, so every subagent inherits the cloud model. Fan
out from a cloud session and the fleet sits idle while you pay for the coder too.

The guard's reasoning is correct and should not be deleted. Silently moving a cloud
parent's subagents onto local weights *is* a quality surprise — the user picked that model.
What is missing is a way to say "not a surprise, this is what I want", per role.

## Supersedes `role-model-chains`

That change proposed an ordered `models:` fallback list per agent. It was aimed at the
wrong thing, on two counts:

**Residency is already solved.** [placement.ts:169](packages/opencode/src/local/placement.ts:169)
scores an already-loaded model `100_000` against a maximum of ~4,000 from every other term —
an absolute tier, commented "same rule as skein". A warm model always wins over one needing
a multi-second swap-in. Nothing to add.

**Per-role model pinning is not what is wanted.** With one model family across the fleet,
pinning changes nothing; and which weights are loaded is managed directly. What is worth
expressing is **which hosts a role may run on**, which then decides the model implicitly.

That is also skein's shape. `ChainEntry` is `{ Provider, ModelRef }` where the comment reads
"optional: direct provider/modelID ref; bypasses model assignment when set" — provider
first, model the exception.

## What Changes

An agent may declare where it wants to run:

```yaml
---
mode: subagent
description: Implements one named slice of an openspec change
placement: local          # a local host, even when the parent is a cloud model
---
```

| value | meaning |
| --- | --- |
| absent / `inherit` | today's behaviour exactly — placement only from a local parent |
| `local` | any eligible local host, even from a cloud parent |
| `[rocky, m3]` | those hosts in order, then any eligible local host |

Declaring it is the authorization the guard was missing. An agent that says nothing keeps
today's behaviour, so no existing setup changes and nothing is ever downgraded silently.

Resolution order becomes: pinned `model:` → explicit `provider` argument → **role
placement** → existing placement → inherit. It still cannot fail: an unreachable or busy
preferred host falls through to ordinary placement and then to the parent's model, exactly
as now.

`coder`, `tester` and `reviewer` ship with `placement: local` — the three gate roles that do
bulk work. `researcher` and `persona-auditor` keep inheriting, because they answer questions
for a human and the parent's model is the right one.

For `reviewer` this is a bonus rather than a compromise: a second opinion from the same
model that wrote the code is barely a second opinion, and a cloud parent with a local
reviewer gets genuine model diversity for free.

## Cloud is not a special case that needs handling

Switching models on a cloud provider is instant and free, so none of the residency
machinery applies to it — and none of it runs, because placement only ever considers
providers with a local `baseURL`. A role that wants cloud simply says nothing and inherits.

## Impact

- One optional agent field. Absent, nothing changes anywhere.
- Delivers "cloud plans, local implements" without touching the guard's default.
- Does not read skein's `chains:`. Those are auto-synthesized identically across all twelve
  roles today, so there is nothing role-specific to consume. If they ever diverge, this
  field is where that config would land.
