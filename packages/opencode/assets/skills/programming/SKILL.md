---
name: programming
description: "MUST USE for ANY work on .py .pyi .rs .ts .tsx .mts .cts .go files. One philosophy: strict types, modern stacks (Pydantic v2 / serde+thiserror / Zod / gin+sqlc+pgx+slog), modern toolchains (uv+basedpyright+ruff / cargo+clippy+miri / Bun+Biome+tsc / gofumpt+golangci-lint v2+nilaway+go-race), parse-don't-validate, exhaustive match, typed errors, no any/unwrap/panic, 250 LOC ceiling, TDD. Routes to references/{python,rust,typescript,rust-ub,go}/. Triggers: write/edit Python/Rust/TypeScript/Go code, new project, gin server, bubbletea TUI, CJK IME, connect-go RPC, sqlc pgx, branded ids, exhaustive match, unsafe Rust, miri, oversized file, refactor, TDD, e2e test, arena, allocator, bumpalo, const fn, const generics, comptime, zero-alloc, bitfield, repr, scopeguard, errdefer, Zig-like, zerocopy, packed struct."
---

# Programming

You are a senior engineer who writes Python, Rust, and TypeScript with one shared discipline. **Type-strict. Stack-first. Async-correct. Architecturally honest about file size.**

This skill is an index. The hard per-language rules live under `references/`. Load the language-specific reference **before** writing a single line of code.

---

## PHASE 0 — LANGUAGE GATE (RUN THIS FIRST, EVERY TIME)

**DO NOT WRITE OR EDIT A SINGLE LINE OF CODE BEFORE COMPLETING THIS GATE.**

1. **Identify the language** from the file extension or the user's request.
2. **STOP** and read the matching reference set:

   | File / Language | MANDATORY reading (load `Read` tool on every file below) |
   |---|---|
   | `.py`, `.pyi`, "Python" | `references/python/README.md` + every file under `references/python/` that the README tells you to load on demand |
   | `.rs`, `Cargo.toml`, "Rust" | `references/rust/README.md` + every file under `references/rust/` that the README tells you to load on demand. **IF the change touches `unsafe`, `*mut`, `*const`, `MaybeUninit`, FFI, `unsafe impl Send/Sync`, or a custom lock-free primitive: ALSO load `references/rust-ub/README.md` plus every file under `references/rust-ub/`.** |
   | `.ts`, `.tsx`, `.mts`, `.cts`, "TypeScript" | `references/typescript/README.md` + every file under `references/typescript/` that the README tells you to load on demand |
   | `.go`, `go.mod`, `go.sum`, `.golangci.yml`, `*.proto` next to a Go module, "Go" / "Golang" | `references/go/README.md` + every file under `references/go/` that the README tells you to load on demand |

3. Only after the references are loaded, apply the **shared philosophy** below plus the per-language iron list from the reference.

**No exceptions for "small" or "one-off" code.** The whole point of the modern toolchain (uv + PEP 723, `rust-script`, Bun) is that disposable scripts cost nothing to write with full discipline.

---

## Shared philosophy (all three languages)

These are not style preferences. They are the six axioms every recipe in `references/` derives from.

1. **The type system is your proof system.** Make illegal states unrepresentable. The compiler / type checker is the cheapest test you will ever run. If a bug can be expressed as a type error, it is *required* to be expressed as a type error.

2. **Parse, don't validate.** Untrusted input crosses a boundary exactly once - at the boundary it is parsed into a typed value (Pydantic v2 in Python, `serde` + `#[derive]` in Rust, Zod in TypeScript). Inside the boundary, code receives typed values and never re-validates. The boundary owns trust; the interior owns logic.

3. **One name = one concept.** A `UserId` is not a `string`. A `Seconds` is not a `Milliseconds`. Use `NewType` (Python), newtype tuple structs (Rust), or branded types (TypeScript) for every distinct semantic primitive. The compiler refuses to let two semantic units mix.

4. **Exhaustive variant matching, always.** Discriminated unions and enums are matched exhaustively. Python: `match` + `case unreachable: assert_never(unreachable)`. Rust: `match` (the compiler enforces). TypeScript: `switch` + `assertNever`. **`if`/`elif`/`else` is forbidden for discriminating on a tagged variant** - it silently swallows new variants.

5. **Trust framework guarantees. Validate only at boundaries.** No null checks for values the type system already proves non-null. No `try/except` around code that cannot raise. No `unwrap`/`!`/`as` to paper over a contract you should have encoded in types. No defensive layer for a scenario you cannot name.

6. **Test-driven, with the right shape of test.** No production line ships without a failing test that proves it was needed. Behavior is locked by tests, not by hope. See the TDD discipline below.

---

## TDD DISCIPLINE — NON-NEGOTIABLE

**Every change follows the red → green → refactor loop.** The order is mandatory; reverse it and you have written speculative code.

### The order

1. **Red.** Write a failing test that names the behavior in `Given / When / Then`. Run it. *Confirm it fails for the right reason* — not a typo, not an import error. A test that fails because the function does not exist yet is the right reason. A test that fails because of a missing import is not.
2. **Green.** Write the minimum code to make the test pass. Resist adding the second case until the first passes. The second case is the next red.
3. **Refactor.** With the test green, restructure ruthlessly. The test is your safety net. If the test is hard to refactor against, the test is bad — fix the test before the code.

### The shape of the test pyramid

Every feature ships with all three rungs, sized in this proportion:

| Rung | Count | Purpose | Speed budget |
|---|---|---|---|
| **Unit** | many | Pure-function correctness for every meaningful input class (happy + edges + boundaries + error paths) | < 10 ms each |
| **Integration** | some | The real adapter against the real downstream (DB, queue, HTTP) — via `testcontainers`, `httptest`, or equivalent. NEVER a unit test pretending to be integration. | < 1 s each |
| **E2E scenario** | few | One narrative per user-visible outcome. Spins the binary or the full app; drives it through its real surface (HTTP route, CLI invocation, TUI keystroke). Asserts the *observable outcome*, not internal state. | seconds, run on CI |

If a feature has zero E2E coverage, it is undone — even if every unit test passes.

### Given / When / Then is mandatory

Every test — unit, integration, E2E — is structured by these three blocks. Names follow `Test_<Behavior>_when_<Condition>` or the language idiom (`it("<does X> when <Y>")`, `#[test] fn behavior_when_condition`).

```
Given: the preconditions and fixtures
When:  the single action under test
Then:  the observable outcome AND only that outcome
```

One `When` per test. Multiple `When`s = multiple tests. The `Then` asserts only what changed because of the `When` — not unrelated invariants.

### Less mock, the better

Mocks are a last resort, not a default. The priority order:

1. **Real object.** Use it when constructable in <1 ms (most domain types, pure functions, value objects).
2. **In-memory fake.** A real implementation of the interface backed by a map/slice — for stores, caches, queues. The fake has its OWN test that proves it behaves like the real one.
3. **Testcontainer / sandbox.** Real Postgres, real Redis, real S3-compatible (MinIO), via `testcontainers`. Slow but truthful.
4. **HTTP-level fake.** `httptest.Server` (Go), `respx` (Python), `msw` (TS) — fake at the wire, not at the SDK.
5. **Mock.** Only when 1–4 are genuinely infeasible (clock, randomness, external SaaS with no sandbox). Then mock the **narrowest** seam — never an entire service. A mock that returns whatever the test wants is a tautology and proves nothing.

**The rule**: if your test fails when the production code's *implementation* changes but its *behavior* did not, the test is over-mocked. Delete the mock; assert on observable outputs.

### Efficient AND accurate — both, not either

- **Accurate**: the test fails for the bug it names, and only that bug. No incidental coupling to format, ordering, whitespace, or unrelated fields. Assert on the *contract*, not on the dump.
- **Efficient**: the whole unit suite runs in < 30 seconds on a developer laptop. The whole integration suite in < 5 minutes. If you cross those budgets, profile and split — fast tests run on every save, slow ones run on push.
- **Deterministic**: no `sleep`, no wall-clock dependence, no order dependence (`-shuffle=on`, pytest-randomly, vitest random seed). Inject a `Clock`. Subscribe to the event, do not poll for it. Time-based flake is a bug, not a test issue.
- **Isolated**: every test starts from a known fixture and tears down. `t.TempDir()`, `t.Setenv()`, transactional rollback for DB tests. Two tests passing individually but failing together is a fixture leak — fix it immediately.

### Prompt tests follow the same rule

When tests cover LLM prompts or agent outputs, assert on **parsed structure, decisions, or rule data**, never on exact prompt strings. Pinning a sentence is brittle pretend-coverage; asserting that the prompt instructs the model to refuse on category X is real coverage.

### Anti-patterns the skill rejects

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Writing code first, tests "to add later" | Tests-after rationalize the existing design, even when wrong. | Red first. Always. |
| One mega-test asserting 12 things | First failure hides the next 11. | Split by `Then` clause — one assertion class per test. |
| Mocking every collaborator | Test passes regardless of real behavior. | Use a fake or the real thing. Mock only true unmockables. |
| `time.sleep(0.1)` to "let it finish" | Flake guaranteed. | Subscribe to the completion signal; bounded await. |
| Snapshot tests for everything | Locks formatting, not behavior. | Snapshots for *structure* (CLI help, JSON shape). Assertions for *behavior*. |
| Removing a failing test to "unblock CI" | You just deleted a bug report. | Fix the code or fix the test — never delete to silence. |
| `assert result is not None` and stopping there | Passes when result is garbage. | Assert the *value*, not its existence. |
| Single happy-path E2E, no edges | Most bugs live on edges. | Edges are unit-test territory — but include at least one E2E that exercises an error path. |

---

## Cross-language iron list

Apply unless the per-language reference overrides with something stricter.

| Rule | Python | Rust | TypeScript | Go |
|---|---|---|---|---|
| Immutable by default | `@dataclass(frozen=True, slots=True)` / Pydantic `frozen=True` | every binding is `let` (not `let mut`) unless mutation is the documented purpose | every field is `readonly`; arrays are `readonly T[]` | value types, unexported fields, no mutation methods unless mutation is the purpose |
| Branded primitives | `UserId = NewType("UserId", int)` | `struct UserId(u64);` (newtype tuple) | `type UserId = Brand<string, "UserId">` | `type UserID string` + smart constructor with unexported field |
| Exhaustive variant matching | `match` + `assert_never` | `match` (compiler-enforced) | `switch` + `assertNever` | sealed interface + type switch + **`exhaustive` linter** (the compiler will not help) |
| No untyped escape hatches | no `Any` in public sigs, no `cast`, no `# type: ignore` | no `unwrap`/`expect` outside `main`/tests, no `as` for narrowing, no `#[allow]` to silence real warnings | no `any`, no `as` (except `as const`, `satisfies`), no `!`, no `@ts-ignore`, no `@ts-expect-error` | no `interface{}` / bare `any` in domain sigs; no `_ = err`; no `//nolint` without reason |
| No bare error strings | typed exception dataclass with `__str__` | `thiserror` enum (lib) or `anyhow` with `.context(...)` (app) | `Error` subclass with typed fields | sentinel `errors.New` + typed `*XError` struct; wrap with `%w`; check via `errors.Is/As` |
| Boundary catch only | catch the exact exception you expect; broad `except Exception` only in `main()`, with logging + re-raise | `?` everywhere; never `panic!` in library code | `catch` must narrow with `instanceof` and re-throw or convert; no empty catch | every `(T, error)` checked; `panic` only in `main`/tests; one `httperr.Write` funnel in handlers |
| Resources via RAII | `with` (sync) / `async with` (async) | `Drop` impl or RAII guard | `using`/`await using` (TC39 explicit resource management) | `defer x.Close()` immediately after acquisition; `bodyclose`/`sqlclosecheck` linters enforce |
| Async runtime is mandatory | `anyio` (NEVER bare `asyncio`) | `tokio` (`async-std` is unmaintained) | platform-native async (Bun/Node) with structured cancellation via `AbortSignal` | `context.Context` as first param + `errgroup` for structured concurrency; `-race` on every test |
| Modern HTTP client | [`httpx2`](https://github.com/pydantic/httpx2) with HTTP/2 + brotli + zstd | `reqwest` with rustls | `ky` (default) / `undici` direct API (Node perf) - NEVER bare `fetch` in prod | stdlib `net/http.Client` with tuned `Transport` + `go-retryablehttp` for retry/backoff |
| No parameter mutation | params are inputs; produce a new value | `&mut` only when mutation is the documented purpose | parameters never reassigned (`noParameterAssign`) | value receivers when not mutating; pointer receivers only for genuine mutation; `copylocks` vet enforces |
| No helpers for one-off | inline a 3-line operation; do not abstract until the second caller | same | same | same |

---

## Modern ecosystem - canonical libraries (2026)

Use these unless the project's manifest explicitly picks something else.

| Domain | Python | Rust | TypeScript | Go |
|---|---|---|---|---|
| Data validation / boundary parse | **Pydantic v2** | **serde** + `#[derive(Deserialize)]` + `validator` | **Zod v4** (Standard Schema) | `validator/v10` (HTTP) + `protovalidate` (proto) + smart constructors (domain) |
| Internal value object | `@dataclass(frozen=True, slots=True)` | newtype tuple struct or plain `struct` | `type` alias with `readonly` | struct with unexported fields + `NewX(...)` constructor |
| Error types | typed exception dataclass | `thiserror` (lib) + `anyhow` (app) | `Error` subclass + Result pattern | sentinel `errors.New` + typed `*XError` struct + `%w` wrap |
| HTTP client | [`httpx2`](https://github.com/pydantic/httpx2) | `reqwest` | `ky` / `undici` | stdlib `net/http` + `go-retryablehttp` |
| Web framework | **FastAPI** | **axum** | **Hono** + `hono-openapi` | **gin** (de facto, ~48%) / `chi` (minimalist) / `connect-go` (RPC) |
| ORM / DB | SQLAlchemy 2.x async + `asyncpg` | `sqlx` (compile-time checked) | **Drizzle** | **sqlc** (codegen from `.sql`) + `pgx/v5` + `goose` migrations |
| CLI | **typer** + `rich` | **clap** (derive) + `color-eyre` + `indicatif` | `@clack/prompts` + `commander` | **cobra** + `huh` (prompts) + `slog` |
| Logging / observability | `structlog` (prod) or `rich.logging` (dev) | **tracing** + `tracing-subscriber` | `pino` (structured JSON) | stdlib **`log/slog`** (NEVER logrus/zap/zerolog for new code) |
| Testing | `pytest` | `cargo nextest` + `proptest` + `insta` | `bun test` / `vitest` | stdlib `testing` + `testify/require` + `goleak` + `autogold` + `rapid` + `testcontainers` |
| Data / analytics | **polars** + **duckdb** + `numpy` (NEVER pandas) | `polars-rs` or `arrow` | (defer to backend service) | `arrow-go` + DuckDB-Go bindings + `gonum` |
| LLM / agent | **pydantic-ai** | (call out to Python via subprocess) | **Vercel AI SDK** | direct `net/http` + Connect (langchaingo not recommended) |
| TUI | **textual** | `ratatui` | `@clack/prompts` or ink | **bubbletea v2 RC** + `bubbles/v2` + `lipgloss/v2` (v2 mandatory for CJK IME) |
| Config from env | **pydantic-settings** | `figment` or `config` | `zod` + `process.env` | `caarlos0/env/v11` (struct-tag env) |

A bare default constructor for any of these (no timeouts, no pool tuning, no schema) is a bug. See the per-language reference for the canonical production defaults.

---

## Modern toolchain - the only acceptable setup

| Tool category | Python | Rust | TypeScript | Go |
|---|---|---|---|---|
| Package / project manager | **uv** (NEVER pip/poetry/conda) | **cargo** + `cargo-nextest` + `cargo-machete` + `cargo-deny` | **Bun** (runtime + package manager); pnpm if Node is forced | **`go modules`** + `go work` for monorepos |
| Type checker | **basedpyright** with `typeCheckingMode = "all"` | the Rust compiler with `-D warnings` + clippy `pedantic` + `nursery` + `cargo` groups | `tsc --noEmit` (or `tsgo` when available) with `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` | the Go compiler + **`golangci-lint v2`** with the strict bundle + **`nilaway`** (nil-deref static analysis) |
| Linter + formatter | **ruff** with `select = ["ALL"]` | `clippy` + `rustfmt` | **Biome** (single binary - replaces ESLint + Prettier) | **`gofumpt`** (stricter gofmt) + `goimports -local` + `golangci-lint v2` |
| Test runner | **pytest** | **cargo-nextest** | `bun test` / `vitest` | stdlib `go test -race -shuffle=on -count=1` + `goleak` |
| UB / soundness gate | (n/a) | **nightly miri** with strict provenance + Tree Borrows pass | (n/a) | **`nilaway`** + `-race` detector + `goleak` are the equivalent gate |
| Disposable scripts | **PEP 723** inline metadata + `uv run script.py` | **rust-script** with inline `Cargo.toml` block | `bun run script.ts` | `//go:build ignore` + `go run script.go` |
| Bootstrap a new project | `scripts/python/new-project.py` | `scripts/rust/new-project.py` | `scripts/typescript/new-project.ts` | `scripts/go/new-project.py` |
| Pre-commit / CI gate | `ruff check . && basedpyright && pytest` | `cargo +nightly clippy -- -D warnings && cargo nextest run && cargo +nightly miri test` | `bunx biome check . && bunx tsc --noEmit && bun test` | `gofumpt -l . && golangci-lint run ./... && nilaway ./... && go test -race -shuffle=on -count=1 ./...` |

A `tsconfig.json` with `"strict": true` alone is **not** strict. The reference enumerates the additional flags. Same for `pyproject.toml` and `Cargo.toml` - the references contain the canonical full configuration.

---

## CODE SMELLS — AUTOMATIC REVIEW TRIGGERS

Most smells below are design review triggers: STOP, re-examine the code, and either fix the smell or justify carrying it with a SPECIFIC reason. **The 250 pure LOC ceiling is stricter: >250 is a DEFECT. Refactor before adding lines except for rare SIZE_OK or pure-data-table exceptions.**

Full rationale, measurement methods, workaround detection, and split examples: **[`references/code-smells.md`](references/code-smells.md)**.

### Smell 1 — File exceeds 250 pure LOC

A source file past 250 non-blank, non-comment lines has outgrown a single reviewer's working memory. The module is almost certainly doing more than one thing. Measure: `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' <file> | wc -l`.

**When detected:** Name what the file owns in one short noun phrase. If the answer needs "and", the file needs splitting. Load `/refactor` and split by responsibility. If the file genuinely cannot be split (generated parser, indivisible state machine), mark with `// allow: SIZE_OK — <reason>`.

### Smell 2 — Function with more than 3 parameters

More than 3 arguments signals the function is doing too much, or that related parameters belong in a typed struct. **Workarounds count as the same smell** — passing `dict`/`Record<string, unknown>`/`map[string]any`/`**kwargs`/`...args` to smuggle parameters through one argument, or a throwaway "config" object with 6+ fields that exists solely to wrap what would otherwise be positional args (genuine reusable domain types like `HttpClientConfig` are fine).

**When detected:** Group related parameters into a typed value object with a domain name. If 4+ independent inputs are genuinely required, the justification must be SPECIFIC. See [`references/code-smells.md` Smell 2](references/code-smells.md#smell-2--function-with-more-than-3-parameters) for examples in every language.

### Smell 3 — Redundant verification after a destructive action

Performing a delete/remove/clear/drop and then immediately querying to "confirm" the thing is gone. **The operation's contract IS the verification.** Re-checking is AI-generated defensive bloat that wastes cycles and teaches the reader the operation is unreliable — which it is not. Same smell: calling a setter then getting to "confirm", writing a file then reading it back, inserting a row then SELECT-ing it, pushing to an array then checking `.length`.

**When detected:** Delete the verification code. Trust the operation's contract. If the operation can genuinely fail silently, fix the operation — do not paper over it with a post-check. See [`references/code-smells.md` Smell 3](references/code-smells.md#smell-3--redundant-verification-after-a-destructive-action) for examples.

### Smell 4 — Negative-form names and conditions

Naming variables, functions, or flags by the **absence** of a quality (`isNotValid`, `noErrors`, `cannotProceed`, `DisableLogging`) instead of its **presence** (`isValid`, `isClean`, `canProceed`, `LoggingEnabled`). Every negation forces the reader to invert mentally; two negations (`if !isNotReady`) become a logic puzzle nobody reviews confidently.

**When detected:** Rename to the positive form and invert the branch logic. Negation IS appropriate in guard clauses (`if !authorized { return }`) and filters (`items.filter(|x| !x.is_expired())`) — the negative form is the intent there. See [`references/code-smells.md` Smell 4](references/code-smells.md#smell-4--negative-form-names-and-conditions) for the full naming table and examples.

---

## MANDATORY POST-WRITE REVIEW LOOP

**This runs EVERY time you finish writing or substantively editing code, before you claim the task is done.** No exceptions.

### Step 1 — measure

For every file you created or modified:

```bash
awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' <file> | wc -l
```

Or run the per-language checker the skill ships:

```bash
# Python
uv run scripts/python/check-no-excuse-rules.py <changed paths>
# Rust
bash scripts/rust/check-no-excuse-rules.sh <changed paths>
# TypeScript
bun run scripts/typescript/check-no-excuse-rules.ts <changed paths>
```

### Step 2 — interpret

| Pure LOC | Verdict | Required action |
|---|---|---|
| ≤ 200 | Healthy | continue |
| 200 - 250 | **Warning band** | State that fact and propose a split if the next edit will add lines. |
| > 250 | **DEFECT** | Do NOT commit new lines to this file. Refactor now: split the touched unit before adding lines, except for rare SIZE_OK or pure-data-table exceptions. |

### Step 3 — architectural self-review (always, even at 80 LOC)

After every code-writing session, answer these out loud (in your reply) before declaring done:

1. **Single responsibility?** Can I name what this file owns in one short noun phrase? If the answer needs the word "and", split.
2. **Boundary purity?** Did I parse untrusted input into a typed value at the boundary, or did I pass `dict[str, Any]` / `serde_json::Value` / `unknown` past the boundary? If the latter, fix it.
3. **Variant discrimination?** Did I use `if`/`elif`/`else` (or `switch` without `assertNever`, or `match` without `assert_never`) anywhere to discriminate on a tagged type or enum? If yes, rewrite as exhaustive match.
4. **Escape hatches?** Any `Any`, `# type: ignore`, `unwrap`, `expect` outside `main`/tests, `as` numeric cast, `!`, `@ts-ignore`, `@ts-expect-error`, `#[allow]` on a real warning? If yes, fix the type or document why with a comment.
5. **Defensive layer?** Any null check, try/except, or `isinstance` guarding a value the type system already proves? If yes, delete.
6. **Helpers for one-off?** Any function, class, or trait introduced for a single caller that will never get a second caller? If yes, inline.
7. **Tests?** Is the behavior I just introduced locked by a test that would fail if I revert this commit?
8. **Parameter bloat?** Any function I wrote or modified that takes more than 3 parameters — or smuggles them through a dict/kwargs/`...args`/throwaway options object? If yes, group related params into a typed value object. See [Smell 2](references/code-smells.md#smell-2--function-with-more-than-3-parameters).
9. **Redundant verification?** Did I perform a destructive action (delete, remove, clear) and then immediately re-query to "confirm" it worked? Did I call a setter then a getter to "verify"? If yes, delete the verification — the operation's contract IS the proof. See [Smell 3](references/code-smells.md#smell-3--redundant-verification-after-a-destructive-action).
10. **Negative naming?** Any variable, function, or flag named by the absence of a quality (`isNotValid`, `noErrors`, `DisableX`) when a positive name (`isValid`, `isClean`, `EnableX`) would work? If yes, rename to positive form and invert the branch. See [Smell 4](references/code-smells.md#smell-4--negative-form-names-and-conditions).

**If any answer fails, fix it before declaring done.** This loop is the difference between "the code compiles" and "the code is correct."

### Step 4 — if you need to refactor right now, invoke the right skill

- Any code smell from the [CODE SMELLS section](#code-smells--automatic-review-triggers) fired (250+ LOC, >3 params, redundant verification, negative naming), or step 3 surfaced more than two issues: **load the `refactor` skill** and execute its safe-refactor protocol (codemap, plan, LSP-driven edits, test after each step). Do not improvise a refactor under time pressure — the refactor skill exists precisely so you do not corrupt behavior while reshaping structure.
- You inherited a branch with AI-generated patterns (broad `except`, redundant null checks, vague TODOs, oversized modules, dead helpers, redundant post-action verification): **load the `remove-ai-slops` skill** to do a categorized branch-scope cleanup with regression tests pinned first.

These two skills are not optional cosmetics. They are the recovery path for the smells this loop is designed to catch.

---

## Companion skills - explicit invocation triggers

| Trigger | Skill to load | Why |
|---|---|---|
| Any [code smell](#code-smells--automatic-review-triggers) fires (250+ LOC, >3 params, redundant verification), OR the post-write loop surfaces 2+ issues, OR the user says "reshape this", "extract this", "clean this up" | `refactor` | Safe codemap-driven multi-step refactor with LSP + tests after each step. Never improvise a structural change. |
| Recent branch contains AI-authored patterns (broad except, dead helpers, vague comments, oversized files, redundant post-action verification), OR the user says "remove slop", "clean AI code", "deslop" | `remove-ai-slops` | Tests pinned FIRST, then categorized parallel cleanup, then quality gates. Behavior-preserving. |
| Rust code touches `unsafe`, `*mut`, `*const`, `MaybeUninit`, FFI, `unsafe impl Send/Sync`, or a custom lock-free primitive | `references/rust-ub/` | Full UB taxonomy + Miri strictness escalation. Every `unsafe` block must survive Miri Level 3 (strict provenance + symbolic alignment + preemption) before it ships. |

---

## Per-language jump table

**Stop. Read the matching reference fully before writing code.**

### Python (`.py`, `.pyi`)

**READ `references/python/README.md` FIRST.** Then load on demand:

| Need | Load |
|---|---|
| Strict pyproject.toml / basedpyright / ruff config | `references/python/pyproject-strict.md` |
| Type patterns (`NewType`, `Final`, `TypeGuard`, `Protocol`) | `references/python/type-patterns.md` |
| Data modeling (Pydantic vs dataclass vs TypedDict vs StrEnum) | `references/python/data-modeling.md` |
| Error handling (typed exceptions, exhaustive match, union returns) | `references/python/error-handling.md` |
| Async with anyio (task groups, cancel scopes, channels) | `references/python/async-anyio.md` |
| httpx2 production defaults (HTTP/2, brotli+zstd, pool tuning) | `references/python/httpx2-optimization.md` |
| **orjson** in hot paths (FastAPI integration, Pydantic v2 `model_dump_json` vs orjson, Redis/queue/log) | `references/python/orjson-stack.md` |
| Data processing with polars + duckdb (NEVER pandas) | `references/python/data-processing.md` |
| FastAPI + SQLAlchemy 2.x async stack | `references/python/fastapi-stack.md` |
| pydantic-ai agents | `references/python/pydantic-ai.md` |
| Textual TUI | `references/python/textual-tui.md` |
| Disposable PEP 723 scripts | `references/python/one-liners.md` |
| Canonical library defaults | `references/python/libraries.md` |

### Rust (`.rs`, `Cargo.toml`)

**READ `references/rust/README.md` FIRST.** It defines the five pillars (explicit allocation, compile-time proof, zero hidden cost, type-encoded invariants, deterministic cleanup) and the post-write review checklist. Then load on demand:

| Need | Load |
|---|---|
| **Arena allocation, const fn, zero-alloc APIs, bitfield, scopeguard, errdefer, Zig-like patterns** | **`references/rust/zero-cost-safety.md`** |
| Strict `Cargo.toml` lints + profile + workspace config | `references/rust/cargo-strict.md` |
| Type-state and newtype patterns (Chris Allen's `Point<Screen>` rule) | `references/rust/type-state.md` |
| `unsafe` discipline (safe wrapper + SAFETY comment + miri proof) | `references/rust/unsafe-discipline.md` |
| Async with tokio (JoinSet, cancellation, select, blocking work) | `references/rust/async-tokio.md` |
| Concurrency primitives (locks, atomics, channels, loom) | `references/rust/concurrency.md` |
| axum + sqlx + tracing + tower HTTP stack | `references/rust/axum-stack.md` |
| clap + color-eyre + tracing + indicatif CLI stack | `references/rust/clap-stack.md` |
| Property tests (proptest) + snapshot tests (insta) | `references/rust/proptest-insta.md` |
| Disposable `rust-script` scripts | `references/rust/one-liners.md` |
| Canonical library defaults | `references/rust/libraries.md` |
| **ANY `unsafe` / FFI / `MaybeUninit` / lock-free work** | **`references/rust-ub/` (full directory)** |

### TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`)

**READ `references/typescript/README.md` FIRST.** Then load on demand:

| Need | Load |
|---|---|
| Strict tsconfig + Biome config | `references/typescript/tsconfig-strict.md` |
| Type patterns (branded types, `as const`, `satisfies`, narrowing, `assertNever`) | `references/typescript/type-patterns.md` |
| Data modeling (type vs interface vs Zod, readonly, parse-don't-validate) | `references/typescript/data-modeling.md` |
| Error handling (Result, typed errors, union vs throw, AbortSignal timeouts) | `references/typescript/error-handling.md` |
| Bootstrapping a new project (Bun, pnpm, Hono, Vite) | `references/typescript/bootstrap.md` |
| Hono backend stack (hono-openapi, Scalar, Swagger, Zod v4) | `references/typescript/backend-hono.md` |

### Go (`.go`, `go.mod`, `go.sum`, `.golangci.yml`, `*.proto`)

**READ `references/go/README.md` FIRST.** Then load on demand:

| Need | Load |
|---|---|
| Library defaults (gin vs chi, sqlc, slog, the 2026 stack reasoning) | `references/go/libraries.md` |
| Canonical strict `.golangci.yml` (v2) with per-linter rationale | `references/go/golangci-strict.md` |
| Project layout, Taskfile, CI, `go.mod` template | `references/go/bootstrap.md` |
| Type patterns (named types, smart constructors, sealed interfaces, generics) | `references/go/type-patterns.md` |
| Data modeling — the three layers of validation (validator/v10 → smart ctor → sqlc) | `references/go/data-modeling.md` |
| Error handling (`errors.Is/As`, typed errors, `%w` wrapping, no panic) | `references/go/error-handling.md` |
| Concurrency (`context.Context`, `errgroup`, channels, locks, `-race`, `goleak`) | `references/go/concurrency.md` |
| HTTP backend stack (gin + slog + validator + pgx, middleware ordering, SSE, WS) | `references/go/backend-stack.md` |
| RPC stack (Connect-Go default, grpc-go fallback, protovalidate, Buf) | `references/go/grpc-connect.md` |
| CLI stack (cobra + slog + huh) | `references/go/cobra-stack.md` |
| Database stack (sqlc + pgx + goose + testcontainers) | `references/go/sqlc-pgx.md` |
| TUI stack (bubbletea v2 + bubbles v2 + lipgloss v2; **CJK / IME support**) | `references/go/bubbletea-v2.md` |
| Testing (Given/When/Then, table-driven, fakes-over-mocks, autogold, rapid) | `references/go/testing.md` |
| Disposable `go run` scripts | `references/go/one-liners.md` |

---

## Activation

This skill activates whenever you are writing or modifying any `.py`, `.pyi`, `.rs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.go` file, or any project manifest (`pyproject.toml`, `Cargo.toml`, `package.json`, `tsconfig.json`, `biome.json`, `go.mod`, `go.sum`, `.golangci.yml`, `Taskfile.yml`, `buf.yaml`, `sqlc.yaml`). **Even one-off scripts get the full treatment** - that is the whole point of `uv run` + PEP 723, `rust-script`, `bun run`, and `go run` + `//go:build ignore`: production hygiene with throwaway ergonomics.

The references contain the recipes. **Read them before writing code. Re-read them when the model drifts.** The post-write review loop is non-negotiable.
