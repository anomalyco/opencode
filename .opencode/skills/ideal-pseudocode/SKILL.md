---
name: ideal-pseudocode
description: Function-by-function refactoring loop driven by ideal pseudocode. Use when the user says "ideal pseudocode", asks to make a function read like its pseudocode, or wants a dense module cleaned up one function at a time.
---

# Ideal Pseudocode

Clean up one function at a time by writing the pseudocode it _should_ read as, naming every delta between that and the real code, and closing only the gaps the user approves.

## Loop

One function per round. Never touch code before the user picks a direction.

1. **Pick the target** with the user — usually the next function up or down the call chain from the last round.
2. **Read the current code** fresh from disk. It may have unsaved or parallel edits; ask before overwriting anything unexpected.
3. **Distill.** Write the function's ideal pseudocode in a `ts`-fenced code block — TypeScript-flavored for syntax highlighting, but pseudocode: comments over mechanics, one line per idea, every arm of a loop visible as an arm. For a dense or unfamiliar function, first show the _current_ structure as pseudocode, then the ideal.
4. **Name the deltas.** A numbered list; each delta is one concrete gap: control flow smuggled through combinators, a flag-typed parameter, colliding names, side-effect plumbing drowning a loop body, twin functions differing only by a filter. For each, give an honest cost/benefit and a decisive recommendation — including "leave it" when the density has reasons (state the reasons).
5. **Verify before proposing.** Any API the proposal builds on (a combinator, schedule, matcher) gets checked against the installed version's source, not memory.
6. **Get buy-in, then apply.** Minimal edits. Quarantine irreducible ugliness inside a small helper whose name is the pseudocode line it implements. Collapse shallow sibling functions into one deep function only when the distinguishing argument is a domain noun, not a behavior switch.
7. **Validate.** Typecheck and the focused test suites from the package directory; rerun timing-sensitive tests repeatedly. Flag any semantic change the restructure introduced, even when tests pass.
8. **Offer the next target** and stop.

## Style

- Keep each round tight: pseudocode block, deltas, recommendation, one question.
- State mutation belongs in one visible place (usually the loop tail), never spread across error channels or callback closures.
- Prefer early return and `if` chains for control flow; matchers are for producing values.
- Compare names against the question each caller is actually asking; rename toward the domain noun.

## Example round

Every round should read like this (abridged from a real one, on an Effect step-runner):

> `runStep` it is. The ideal pseudocode:
>
> ```ts
> // One logical step: one settled model call, however many attempts it takes.
> // An attempt can end without settling in two ways:
> //   transient provider failure -> retry the same call, same assistant message
> //   compaction rewrote history -> rebuild the request and call again
> function runStep(session, promotable, step) {
>   while (true) {
>     const result = callModel(session, promotable, step)
>
>     if (result.completed) return result
>
>     if (result.retryable) {
>       wait(retrySchedule) // exhausted -> publish Step.Failed, fail drain
>       promotable = none // never re-promote on a second attempt
>       continue
>     }
>
>     // compaction restarted the step: fresh request from rewritten history
>     promotable = none
>     step = result.step
>   }
> }
> ```
>
> Comparing against the real thing, three deltas:
>
> 1. **The retry arm doesn't live in the loop.** In the pseudocode, retry is just another loop arm. In the real code it's smuggled through the error channel: `Effect.tapError` mutating loop variables via `Effect.sync` closures, then `Effect.retryOrElse` re-running a suspended call. Four mutable variables mutated from three different places — the state flow is invisible unless you already know the trick.
> 2. **`recoverOverflow: typeof compaction.compact | undefined`** — a function-typed parameter used as a one-shot armed/disarmed flag. The callee already closes over `compaction`; a boolean says what it is.
> 3. **`assistantMessageID`** exists solely to resume the same durable message across retries — fine, but only legible once the retry arm is visible in the loop.
>
> The unifying move for (1): a schedule driver, so a retryable failure becomes a caught value handled in the loop body exactly like the compaction arm. One honest trade: it's more manual than the blessed combinator — but the manual version is the loop the combinator was hiding, and the loop already exists for restarts. Two restart mechanisms, one control structure.
>
> Want me to apply it — unified loop, simplified schedule input, boolean `recoverOverflow`?
