# Node / TypeScript principles

The single source of truth for every Axiomic Node/TypeScript repo. Synced into each repo; do not fork it locally.

Two repo shapes exist today and both must converge on these rules:

- **Site** — the Astro 5 marketing/blog app (`website`): npm, Node 18, content collections, deployed via bash → S3/CloudFront + Terraform.
- **Mono** — the Bun workspace monorepo (`opencode`): Bun 1.3.x, Turborepo, SolidJS + Hono + Effect + AI SDK, Drizzle, SST.

Rules are **[ALL]** unless tagged **[Site]** or **[Mono]**. The non-negotiables lead: strict TypeScript and Zod at every boundary. Everything downstream of "the types are honest and the edges are parsed" is cheaper to get right.

---

## 1. TypeScript strictness (the floor, not the ceiling)

**[ALL] `strict: true` is mandatory. Never disable a sub-flag to silence an error.** Suppressing strictness converts a compile-time bug into a production bug. Fix the type, don't lower the bar.

**[ALL] Enable `noUncheckedIndexedAccess`.** Array/record access becomes `T | undefined`, forcing you to handle the missing case — the single highest-value flag beyond `strict`. Note: `opencode/packages/opencode` currently sets it `false` — that is debt to pay down, not a pattern to copy. New packages keep it on.

**[ALL] Enable `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`.** Each closes a class of silent logic/dead-code bug for free. Consider `exactOptionalPropertyTypes` for new packages (distinguishes "key absent" from "key set to `undefined`").

**[ALL] Enable `verbatimModuleSyntax`; use `import type` / `export type` for type-only imports.** Guarantees 1:1 source-to-emit semantics and kills phantom runtime imports — critical under Bun's `--conditions` and Astro's ESM pipeline.

**[ALL] Ban `any`. Use `unknown` at boundaries and narrow.** `any` is a hole through the type system; `unknown` forces a checked narrowing — the TS form of "parse, don't trust."

**[ALL] Ban non-null `!` and unchecked `as` in app code.** Allow `as` only for `as const` and immediately after a validated boundary. If you "know" a value is present, prove it with a guard or Zod, not an assertion.

**[ALL] Forbid `@ts-ignore`. Require `@ts-expect-error` with a one-line reason when truly unavoidable.** `@ts-expect-error` self-deletes when the underlying issue is fixed, so suppressions can't rot.

**[ALL] Lean on inference; annotate only at exported boundaries.** Let inference do the work; add explicit types where they form a public contract (exports, schemas, signatures consumers depend on).

**[Site] Adopt `astro/tsconfigs/strict` (or `strictest`), not `base`.** The site currently extends `base`, which is loose. Move to `strict` so the marketing app meets the same floor as everything else. Keep `astro.config.mjs` under `// @ts-check`.

**[Mono] Each package extends a shared base config; use project references / `tsgo -b` for incremental builds.** The Bun base (`@tsconfig/bun`) gives `strict`; per-package configs only add `paths`, `jsx`, and the `@effect/language-service` plugin. No per-package strictness drift.

**[ALL] Type-checking is a required, bundler-independent CI gate.** Bun, Vite, and Astro transpile without type-checking. Run the real checker (`tsgo --noEmit` / `tsc --noEmit` / `astro check`) in CI, or untyped code ships green.

---

## 2. Runtime validation with Zod (the Pydantic analog)

**[ALL] Validate every untrusted input at the boundary with a Zod schema; type-check everything inside.** TypeScript guarantees nothing at runtime. Zod is the only thing between external data and your typed core — the role Pydantic plays in our Python services. Standardize on **zod v4** (Mono's catalog version); the Site already gets zod transitively via `astro:content`.

**[ALL] Boundaries that MUST parse:** HTTP requests/responses, env vars, CLI args/flags, file/JSON/YAML reads, `localStorage`/IPC/postMessage, webhooks, AI/LLM tool outputs, and any `JSON.parse`. These are all `unknown` wearing a type costume; unparsed, they corrupt the typed core silently.

**[ALL] Derive types from schemas with `z.infer`; never hand-write a type that duplicates a schema.** One source of truth keeps the runtime shape and the static type from drifting.

**[ALL] Define each schema once at module scope and reuse it.** Never construct schemas in hot paths or per-request — it's slower and invites divergence.

**[ALL] Prefer `.safeParse()` and handle the `success: false` branch explicitly.** Reserve `.parse()` (which throws) for genuine invariants. The discriminated result forces you to inspect failure instead of swallowing it via exception.

**[ALL] Use `.strict()` on object schemas for external payloads** unless extra keys are intentional. Rejecting unknown keys catches API drift and typos instead of ignoring them.

**[ALL] Parse env once at startup into a frozen, typed `config` object.** Never read `process.env` / `import.meta.env` deep in the app. Fail fast at boot on misconfiguration; a `VITE_`-prefixed-or-not mistake should crash startup, not surface hours later.

**[Mono] Keep validation at the edges via the existing stack:** `@hono/zod-validator` + `hono-openapi` for HTTP, schemas at the AI-SDK tool boundary, Drizzle for the DB edge. Effect Schema is acceptable inside Effect-native code, but a single boundary should not mix both validators.

**[Site] The `src/content/config.ts` Zod collection schema IS the boundary** for blog frontmatter — keep it exhaustive (required `title`/`description`/`author`/`pubDate`, typed optionals). Don't reach around content collections to read raw markdown untyped.

---

## 3. Error handling (explicit, typed, never silent)

**[ALL] No empty or log-only `catch`. Handle, recover, or rethrow with context.** A swallowed error is a deleted incident report.

**[ALL] Treat `catch (e)` as `unknown`; narrow with `instanceof` before use.** Anything can be thrown in JS; assuming `e.message` exists is a latent crash.

**[ALL] Model expected/recoverable failures as a `Result<T, E>` discriminated union** (`{ ok: true, value } | { ok: false, error }`); reserve `throw` for the truly exceptional. Result types make the compiler force callers to handle the failure path. (In Effect-native Mono code, use `Effect`'s typed error channel — same principle, native idiom.)

**[ALL] Define a small hierarchy of tagged error classes with a `code` discriminant; never throw bare strings or plain objects.** Call sites branch on `error.code` exhaustively instead of string-matching messages.

**[ALL] Always `await`, `.catch`, or explicitly `void` every Promise.** An unawaited rejection is an unhandled rejection — a silent failure that crashes Node or vanishes in the browser. Enforce `no-floating-promises` where lint is wired.

**[Mono] CLI: print a clear message to `stderr` and exit non-zero on failure; install a global `unhandledRejection`/`uncaughtException` net.** Exit codes are the CLI's API contract — never `process.exit(0)` on failure. The top-level net guarantees the one error you missed gets logged.

**[Site/UI] Wrap route/feature subtrees in error boundaries with a real fallback** (SolidJS `<ErrorBoundary>` in Mono UI; component-level fallbacks in Astro islands) plus `window.onunhandledrejection`. An uncaught render error otherwise blanks the whole view.

---

## 4. Async & concurrency discipline

**[ALL] `async/await` everywhere; don't mix raw `.then()` chains with `await` in one flow.** One style keeps control flow and error propagation predictable.

**[ALL] Parallelize independent awaits with `Promise.all`; use `Promise.allSettled` when partial failure is acceptable.** Sequential `await` of independent work is a latency bug; `allSettled` keeps one rejection from discarding good results.

**[ALL] Thread an `AbortSignal` through fetches and long operations and honor it.** Without cancellation you leak in-flight work on unmount (UI) or on SIGINT (CLI).

**[UI] Cancel or ignore stale async results in effects** (cleanup function or signal) to avoid race-y state writes — the classic out-of-order render bug.

**[ALL] Never block the event loop; offload CPU-heavy work to a worker thread.** A blocked loop freezes the UI or stalls every concurrent server/CLI task.

---

## 5. Modules, structure & exports

**[ALL] ESM only (`"type": "module"`). No CommonJS in new code.** Both repos are already ESM throughout; keep it that way to avoid dual-package/interop hazards.

**[ALL] Named exports only.** Allow a default export only where a framework demands it (Astro pages/layouts, a route module). Named exports give stable identifiers, safe refactors, and tree-shaking.

**[ALL] One responsibility per module; co-locate a unit's types, schema, and logic; keep files small.** Cohesion makes code navigable and shrinks the blast radius of a change.

**[ALL] Forbid circular and cross-layer imports.** Cycles cause `undefined`-at-init bugs and signal a structure problem. Use path aliases / `workspace:` package refs instead of `../../../` chains.

**[Mono] One concern per workspace package; communicate only through each package's published `exports` map.** No reaching into another package's internals. Internal deps use `workspace:`/catalog refs so versions stay aligned. Build libs to ESM + `.d.ts`; CLIs ship a `bin` with a proper shebang.

**[Site] Organize by feature/route; keep `blog-raw/` (authored) and `blog/` (generated) separation sacred.** Never edit generated content; the `npm run dev` conversion owns it.

---

## 6. Immutability & data modeling

**[ALL] `const` by default; never `var`; `let` only when reassignment is essential.** Const-by-default communicates intent and prevents accidental rebinding.

**[ALL] Treat data as immutable: return new objects/arrays via `map`/`filter`/spread; don't mutate inputs.** Shared mutable state is the root of action-at-a-distance bugs and missed UI re-renders.

**[ALL] Mark fixed config/lookups `as const`; type shared data with `readonly` / `ReadonlyArray`.** Let the compiler enforce immutability instead of relying on discipline.

**[ALL] Model domain state as discriminated unions; make impossible states unrepresentable.** A `loading | error | success` union beats boolean soup (`isLoading && !error && data`) that can express contradictions.

**[ALL] Prefer `type` for unions/composition; `interface` for extendable object contracts. Be consistent.** A single convention avoids bikeshedding and surprising declaration merging.

**[Mono] Follow the house style guide:** single-purpose short identifiers, early returns over `else`, ternaries over trivial `if/else` assignment, functional array methods, inline single-use values, prefer Bun APIs (`Bun.file()`), Effect/`@effect/*` imported as namespaces, Drizzle fields in snake_case.

---

## 7. Tooling: format & lint

**[ALL] Prettier owns formatting only; it is the one formatter.** Match Mono's house config (`semi: false`, `printWidth: 120`) and the shared `.editorconfig` (2-space, LF). Format on save (`bunx prettier`) and as a CI check.

**[ALL] Adopt ESLint 9 flat config with `typescript-eslint`, type-aware.** Today only an isolated VSCode-SDK uses ESLint and the Site has none — that's the gap to close. Enable `recommendedTypeChecked`/`strictTypeChecked` so `no-floating-promises`, `no-misused-promises`, and `no-unsafe-*` actually run. Use `eslint-config-prettier` to disable stylistic rules; never run Prettier *through* ESLint.

**[ALL] `eslint --max-warnings=0` in CI: warnings are errors.** A tolerated warning is a permanent warning.

**[ALL] One shared lint/format/tsconfig, committed centrally — no per-folder drift.** In Mono this is a shared config consumed by every package; the Site consumes the same exported config.

**[ALL] Pre-commit hook runs format + lint on staged files only.** Mono already enforces a husky `pre-push` (Bun-version + `bun typecheck`); extend the same discipline to formatting/lint so junk never enters history.

---

## 8. Testing & TDD

**[ALL] TDD by default: Red → Green → Refactor. Write the failing test first.** Tests written first define the contract and prevent test-shaped-to-the-bug rationalization.

**[ALL] Tests are isolated and deterministic — no real network/DB/external/LLM calls.** Mock at the boundary. This mirrors the platform's hard rule against real external calls in tests: flaky, slow, and occasionally expensive is non-negotiable to avoid.

**[Mono] `bun test` is the runner (happy-dom for DOM units), Playwright for e2e.** Honor the guard: tests run from package dirs, never the repo root (`bunfig.toml [test] root`). Orchestrate via `bun turbo test`. Prefer testing the real implementation over heavy mocking — but when you do mock, pin to the real interface (typed mocks / `satisfies`) so signature changes break the test.

**[Mono] Cover CLI commands end-to-end:** invoke with arg vectors; assert stdout, stderr, and exit code — that's the CLI's real contract.

**[Site] Zero tests today is the standout gap.** Add at minimum: a build-passes/`astro check` gate in CI and a Playwright smoke test that the homepage and one blog route render. The content-collection Zod schema should have valid/invalid frontmatter tests.

**[ALL] Every Zod boundary schema has tests for both valid and invalid input.** Validation is load-bearing correctness/security code; prove you reject the bad case.

**[ALL] Enforce 100% coverage on new/changed lines (diff-coverage) in CI; fail below.** Coverage is a contract, not an aspiration. Mono ratchets toward full coverage; the Site starts from zero and ratchets up — never down. Mirrors the Python 100%-for-new-code standard.

---

## 9. Dependency hygiene

**[ALL] Pin via a committed lockfile; CI installs frozen.** Mono: `bun.lock` + `bunfig.toml` `install.exact = true` + `bun install --frozen-lockfile`. Site: `package-lock.json` + `npm ci`. Reproducible installs mean "works in CI" equals "works in prod."

**[Mono] Use the Bun workspace catalog for shared versions; one version of each shared dep across the workspace.** Catalog refs (`"catalog:"`) + `overrides` + `patchedDependencies` are the mechanism — duplicate React/Solid/Zod copies cause brutal runtime failures. Keep `patches/` minimal and documented.

**[ALL] Pin the toolchain, not just libs.** Mono pins `packageManager: "bun@1.3.11"` and enforces it via pre-push — keep that. Site pins Node via `.nvmrc` (currently 18); **migrate off Node 18 (EOL) to Node 22 (active LTS)** — tracked in DEFERRED.

**[ALL] Add dependencies deliberately; justify each.** Prefer the platform/stdlib or a small focused lib over a framework. Every dep is attack surface, bundle weight, and a future migration.

**[ALL] Keep `dependencies` vs `devDependencies` honest** (types and build tools are dev-only), and automate updates (Renovate/Dependabot) with `audit`/`outdated` in CI.

**[Site] Budget bundle size** and prefer dynamic `import()` for rarely-used client code — every kB is user-perceived load time on a marketing site.

---

## 10. Cross-cutting conventions

**[ALL] Structured, leveled logging in shipped code; no stray `console.log`.** Lint it out. Structured logs are queryable and silenceable; `console.log` is noise that leaks to users (use a logger / Effect logging in Mono).

**[ALL] Never log secrets, tokens, or PII**, and keep them out of error messages. A log line is retained and indexed; a leaked token is a permanent leak.

**[ALL] No secrets in code or client bundles.** Only build-time public values reach the browser (Astro `PUBLIC_`* / Vite `VITE_`*). A mis-prefixed secret is published to every visitor. Secrets live in SST/Terraform-managed config, never the repo.

**[ALL] Document public APIs/commands with examples-first usage.** Types carry the contract; prose carries the usage. Mirror the platform's docstring philosophy — show how to use it, not how it works internally.

**[ALL] Default branch and flow conventions are explicit per repo** (Mono ships from `dev`). Branch before committing; never push straight to the default branch.

**[ALL] Reproducible CI gate, fail-fast, in order:** frozen install → typecheck (`tsgo`/`tsc`/`astro check`) → lint (`--max-warnings=0`) → format check → test (with coverage) → build. "Green" must mean type-safe, lint-clean, formatted, tested, and buildable — every time. Mono orchestrates this through Turborepo with cached, scoped tasks; the Site runs the same stages before its bash → S3/CloudFront deploy.

---

## Reference base tsconfig (both shapes extend this)

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "target": "ES2023"
    // Mono (Bun):   extends "@tsconfig/bun"; "moduleResolution": "Bundler"
    // Site (Astro): extends "astro/tsconfigs/strict"; checked via `astro check`
  }
}
```

**The one-line test for any change:** are the types honest, are the edges parsed with Zod, and does every failure path either get handled or loudly crash? If yes, ship it.
