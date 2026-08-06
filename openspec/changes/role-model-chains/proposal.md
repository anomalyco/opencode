# Per-role model chains that degrade instead of failing

## Why

Skein's `chains:` was the right idea: a role maps to an ordered list of
`<system>/<provider>:<agent>` entries, so `reviewer` can run on a small fast local model
while `coder` gets the big one. It never worked well in practice — the failure modes
always got in the way, and a chain that dead-ends is worse than no chain, because the work
simply stops.

The reason is worth naming, because it decides this design: skein's chain was a
*resolution* mechanism. If nothing in the list resolved, there was no answer. Routing that
can fail is a new way for an unattended run to halt.

opencode's subagent model resolution today is `next.model ?? placed?.placement ?? inherited`
([task.ts](packages/opencode/src/tool/task.ts)) — a pinned agent model, else placement onto
an idle fleet node, else inherit the parent's. That already has the property skein's chain
lacked: **it always terminates in something usable.** What it lacks is preference. There
is no middle setting between "pinned to exactly this model" — which also switches
placement off entirely, so a pinned reviewer will queue behind a busy host rather than
move — and "wherever placement feels like".

`persona-gate-fanout` makes this matter. A reviewer that gets a second opinion from the
same model that wrote the code is barely a second opinion.

## What Changes

### 1. `models:` — an ordered preference list on an agent

An agent definition may declare an ordered list instead of a single pin:

```yaml
---
description: Reads finished work and emits a verdict
mode: subagent
models:
  - local/rocky:qwen3-coder
  - local/m3:qwen3-coder
  - anthropic/claude-sonnet-5
---
```

Entries are tried in order. The first that is reachable and has capacity wins.

### 2. Falling off the end is normal, not an error

If no entry in the chain is usable, resolution continues exactly as it does today:
placement, then inherit. **A chain never halts a run.** It expresses preference, and
preference that cannot be satisfied is silently downgraded rather than raised as a
failure. This is the one thing skein got wrong and the reason to do it again.

The downgrade is *reported* — the run states which chain entry it used, or that it fell
through — so a chain that never once gets its first choice is visible rather than
mysterious.

### 3. Chain and pin do not both apply

`model:` stays as it is: an absolute pin that disables placement. `models:` is the
preference list. Declaring both is a configuration error, reported when the agent is
loaded, because the two mean contradictory things about whether placement may move the
work.

## Impact

- Additive. Agents without `models:` behave exactly as they do now.
- Composes with `persona-gate-fanout`: a different model for the reviewer than the coder
  is a two-line config change once this exists.
- Does not attempt skein's cross-*system* routing (`<system>/…`). Chain entries name a
  provider and model within this instance's reach; fleet spread stays placement's job.
