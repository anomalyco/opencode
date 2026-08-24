# Make the loop completion signal reachable by the model

## Why

`/loop` has exactly one positive completion path, and it is unreachable.

`loop.ts:18` defines `COMPLETE_SIGNAL = "<promise>COMPLETE</promise>"` and `loop.ts:207`
tests `output.includes(COMPLETE_SIGNAL)`. But the iteration prompt is the raw user
string sent verbatim — `loop.ts:161-166` passes `record.info.prompt` as the only text
part, with no wrapper, no suffix, and no system-prompt injection. Nothing anywhere in
`session/system.ts` or the prompt builder mentions the token.

**The model is never told the safe word exists.** A repo-wide search finds the literal
only in `loop.ts`, in two tests that hand-feed it through a mock LLM, and in the
`tui-loop-command` design docs. The `.skein/agents/*.md` personas emit *different*
tokens (`TASK_COMPLETE`, `PLAN_COMPLETE`, `VERIFY_PASS`) which the loop does not match.

The consequence is that a loop can never end with `completed`. Every real loop
terminates via `stalled`, `max_reached`, `cancelled`, or `error` — all failure-shaped
outcomes. A user who writes `/loop keep working until done` gets a run that burns to
the iteration cap and reports a fault, even when the work finished on iteration three.
This is the single largest reason the feature "works but feels broken".

Detection is also brittle. `includes` is exact-substring: no tolerance for whitespace,
casing, or the model wrapping the tag in a code fence — and it fires on a false positive
if the model quotes the user's prompt back and the prompt itself contained the token.

## What Changes

### 1. Inject a completion contract into every iteration

`runIteration` wraps the user prompt with an explicit contract appended as a separate
text part, so the user's own words stay first and unmodified:

```
<loop-contract>
You are running inside an automated loop (iteration N of MAX).
When the task described above is fully complete, emit exactly this token on its
own line as the last line of your response:
<promise>COMPLETE</promise>
Do not emit it for partial progress. If you cannot proceed, explain why and do not
emit the token.
</loop-contract>
```

The contract is injected per iteration (not into the system prompt) so it stays
accurate as `N` advances and does not leak into non-loop sessions.

### 2. Configurable stop word, defaulting to the current token

`CreateInput` gains `completionToken?: string`, defaulting to `<promise>COMPLETE</promise>`.
This keeps the existing skein `<promise>…</promise>` convention — the same shape the
`.skein/agents` personas already use — while letting a caller align a loop with a
persona that signals `TASK_COMPLETE`.

### 3. Harden detection

Replace the bare `includes` with a matcher that:
- normalises case and collapses whitespace inside the tag
- accepts the token inside a fenced code block
- requires the token in the **final** 200 characters of the output, so a mid-response
  mention (or an echo of the user's prompt) does not terminate the loop
- ignores any occurrence that also appears verbatim in the iteration's input prompt

### 4. Surface the contract in help

`opencode loop --help` and the TUI `/loop` hint state the stop word, so a user reading
help knows what the agent is being asked to emit.

## Capabilities

### Modified Capabilities
- `loop-service`: completion detection becomes reachable and robust; adds
  `completionToken` to loop creation.

## Non-Goals

- No change to `stalled` / `max_reached` / no-progress detection — those stay as the
  safety net and are covered by `fix-loop-reliability`.
- No multi-token grammar (e.g. distinct `BLOCKED` / `NEEDS_INPUT` signals). One
  positive completion token; everything else is a failure mode. A richer vocabulary
  can follow once this one works.
- Not changing the per-iteration session model — that is `fix-loop-reliability`.

## Impact

- Modified: `packages/opencode/src/loop/loop.ts` (contract injection, matcher,
  `completionToken` in `Info`/`CreateInput`), `packages/opencode/src/cli/cmd/loop.ts`
  (help text), `packages/tui/src/component/prompt/index.tsx` (hint text).
- SDK: `packages/sdk/js/src/v2/loop-args.ts` gains `completionToken`.
- Tests: `packages/opencode/test/loop/loop.test.ts` — the two tests that hand-feed the
  literal keep passing; new tests cover the matcher edge cases.
- No API break: the default token is the existing constant.
