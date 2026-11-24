# Code Review Guide

Merge-blocking checks for `anomalyco/opencode`. Reviewers (human and automated) should focus on correctness, architecture, and real regressions — not style nits or formatting.

## Architecture & Boundaries

- **Package dependency direction:** `Schema` -> `Core` / `Protocol` -> `Server`. Client runtime code (`packages/client`) may depend on `Schema` and `Protocol`, never `Core` or `Server`. `sdk` composes `Client`, `Core`, and `Server`.
- **Generated client files:** Any change to public Protocol or Server `HttpApi` requires regenerating via `bun run generate` in `packages/client`. Never hand-edit generated client files.
- **Async plugin loading:** Server handlers must never wait for plugin activation (`Plugin.awaitActivation`), retry until something loads, or turn slow plugins into timeouts/503s. Clients wait or refresh on `*.updated` events.
- **Session Core invariants:** Keep durable events minimal (irreducible facts, no redundant derived state). Keep prompt admission (`session.inbox.enqueued`) separate from execution wakeups. Do not add in-memory tool loops; each step is one explicit `llm.stream` call.
- **Validate once at the boundary:** Do not add defensive `typeof` or property-existence re-checks for values already guaranteed by a schema, constructor, or internal type.
- **No speculative scope creep:** Fix the bug class (including sibling call sites sharing the same defect), not unrelated drive-by refactors. Do not add complexity for theoretical races without a concrete failure mode.

## Public API & Feature Flags

- **Experimental APIs:** New endpoints start under `/api/experimental/<group>/...` with matching `experimental.<group>.<method>` identifiers. New fields on stable endpoints go under `experimental.<name>`.
- **Backwards compatibility:** Breaking moves of shipped SDK or plugin APIs must keep `@deprecated` aliases until the next minor release.
- **Feature flags:** New user-visible behavior or risky core changes belong behind a flag in `packages/schema/src/config/flag.ts` (read via `Flag.enabled(...)`), named in the PR description. Bug fixes, refactors, docs, and tests do not need flags.

## Correctness & Platform Safety

- **Cross-platform paths & shells:** Check POSIX vs Windows assumptions (drive paths, separators, case sensitivity, shell builtins, CRLF) whenever touching filesystem, process spawning, or environment path code.
- **Error handling:** Never swallow errors silently (`catch {}`) or report success on failure. Propagate typed errors; keep Effect generators clean (bind services to named variables before calling methods — never `yield* (yield* Foo.Service).bar()`).
- **TUI theme tokens:** Use semantic role tokens, never raw `theme.hue` or borrowed unrelated tokens. Check built-in light, dark, and custom-theme fallbacks when changing token surfaces.

## Tests

- **Prove the fix:** Behavioral changes need focused tests that fail without the fix and pass with it — except tiny one- or few-line fixes, where tests should not be demanded or padded unnecessarily.
- **No flaky patterns:** Avoid `setTimeout`/`sleep` synchronization, live network calls, shared mutable state, or `globalThis.*` mocks. Await observable conditions.
- **Never weaken existing safety nets:** Do not silently delete, skip, or loosen existing tests or assertions to get CI green.

## Imports & Hygiene

- **Imports:** No aliased imports (`import { a as b }`), no star imports (`import * as Foo`), no type-position `import("...")`. Use dynamic imports inside cold branches for heavy startup-sensitive modules.
- **Keep small fixes small:** Flag unnecessary multi-line explanatory comments justifying workarounds, dead code left behind, or `.changeset` files (this repo does not use Changesets).
