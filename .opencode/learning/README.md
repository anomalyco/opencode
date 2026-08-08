# opencode learning system

Auto-capture plugin + staged approval + independent memory store for opencode.
Makes opencode learn like Hermes: skills are generated from successful sessions,
memory is durable, and the captain approves everything before it goes live.

MIT — self-contained, no opencode core changes. Works as a plain opencode
plugin directory (`.opencode/`).

## Layout

```
.opencode/
  plugins/fm-primary-learning.js   capture + memory injection plugin
  learning/fm-learning-core.js     shared logic (classify, stage, promote)
  command/learn-review.md          /learn-review command (present + approve)
```

Runtime state (independent of firstmate's data dirs, per the captain's choice):

```
~/.agents/
  learning-staging/skills/<name>.json    staged skill candidates
  learning-staging/memory/<id>.json      staged memory candidates
  skills/<name>/SKILL.md                 live skills (promoted only)
  memory/facts.md                        live memory (promoted only)
```

## How it works

1. **Capture** — `fm-primary-learning.js` hooks `session.idle` (same event the
   watcher plugins use; it only reads, never prompts, so there is no conflict).
   A simple heuristic classifies the finished session:
   - tool calls that wrote files / committed / installed → skill candidate
   - explicit durable facts about the captain's environment or preferences →
     memory candidate
   - neither → nothing
   Candidates land in `~/.agents/learning-staging/`. The plugin never writes to
   the live skill library.

2. **Approval** — `/learn-review` presents staged candidates in chat ("3 new
   skills, 2 memory facts from today — approve?"). The captain answers yes/no
   per item. The captain never browses the staging folder: the agent curates,
   the captain approves. On approval the agent promotes:
   - skill → `~/.agents/skills/<name>/SKILL.md` (description ≤ 200 chars)
   - memory → `~/.agents/memory/facts.md` (deduped line)
   Staged files are renamed `.promoted` / `.rejected` so they are not presented
   again.

3. **Memory injection** — on `session.created`, the plugin reads
   `~/.agents/memory/facts.md` and injects the facts into the first user prompt
   (same mechanism as the sessionstart-nudge pattern).

4. **Weekly audit** — the learning system does not duplicate the audit. It feeds
   it: staging + usage evidence are inputs to `/audit-skills`
   (`~/.agents/skills/audit-skills/`), which proposes removals; the captain
   approves. "Less is more."

## Testing

```bash
cd packages/opencode
bun test test/learning/learning.test.ts
```

Tests cover classification, staging, promotion, dedupe, rejection, the
description budget, and slugging. They run against a temp `FM_LEARNING_HOME`
and never touch the real `~/.agents`.

## Env

- `FM_LEARNING_HOME` — override the base dir (default `~/.agents`). Used by
  tests; also useful for dry-run deployments.
