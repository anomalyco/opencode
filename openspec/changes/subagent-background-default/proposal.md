# Task tool: background subagents default to background, not foreground

## Problem

`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` lets a subagent run asynchronously:
`task(..., background: true)` returns a placeholder immediately, the parent keeps
working, and the result is injected later as a synthetic user message.

In practice, weak local orchestrator models (small quantized models running on the
llama-skein fleet) never set `background: true`. Faced with a large task (e.g. a
22-file, 80+ reference refactor), they delegate the *entire* thing to a single
foreground subagent and then just... wait. The parent blocks synchronously on that
one `task()` call, the other fleet hosts sit idle, and no other work happens until
the single child finishes.

The tool description already tried to steer this: `BACKGROUND_DESCRIPTION` was
rewritten from "foreground is the default" to "PREFER background=true whenever the
work is independent". That wording change alone didn't help — a model that isn't
reasoning carefully about tool parameters just calls the tool without setting
`background` and gets whatever the *parameter default* is. Prose preference in a
description cannot overcome a blocking default.

## Root cause

`packages/opencode/src/tool/task.ts` computed:

```ts
const runInBackground = params.background === true
```

Background was opt-in. Any call that didn't explicitly set `background: true` -
which is the common case for models that don't reliably attend to optional tool
parameters - ran in foreground and blocked the parent's turn.

## Fix

Flip the default to opt-out once the experimental flag is on, so background
execution requires no model cooperation:

```ts
const runInBackground = flags.experimentalBackgroundSubagents && params.background !== false
```

Guard preserved: when `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` is off, the
`background` field is stripped from the tool's JSON schema entirely (existing
behavior), so `params.background` is always `undefined` for those callers - the new
default must fall through to foreground rather than defaulting on and tripping the
"Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true" guard.

`BACKGROUND_DESCRIPTION` and the `background` parameter's schema annotation were
reworded to state the new default plainly ("defaults to true; pass false to
block") instead of a "prefer" framing that no model actually needs to act on now.

## Verification

- `bun run typecheck` (tsgo --noEmit) passes.
- Not yet observed against a real fleet run with a weak local orchestrator - the
  originating symptom (single foreground delegation, idle fleet) should stop
  recurring once this ships to the hosts that opencode-skein itself runs on.
