# Repository Guidance

## Scope

- The default branch is `dev`; use `dev` or `origin/dev` for diffs because a local `main` may not exist.
- Follow the nearest `AGENTS.md` for the files you change. More specific nested guidance takes precedence over this file.
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before implementing or opening a PR.

## Setup

- Use the Bun version pinned by the root `package.json` `packageManager` field (currently `bun@1.3.14`).
- Run `bun install` from the repository root.

## Contribution Gates

- Get core-team design approval before implementing UI or core product features.
- Every PR must link an existing GitHub issue. Keep PRs focused and explain verification for logic changes.
- Include before-and-after screenshots or video for UI changes.
- Use short branch names of at most three hyphen-separated words, without slash or type prefixes.
- Use conventional commit and PR titles: `type(scope): summary`. Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`.

## Validation

- Run tests from the owning package, never the repository root; the root `test` script intentionally fails. Use that package's `test` script (`bun run test`) when it exists, or `bun test <relative-test-path>` for a focused test.
- Run package typechecks with `bun run typecheck` from the owning package. Run repository-wide checks from the root with `bun run lint` and `bun run typecheck`; do not invoke `tsc` directly.

## Generated Code

- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. The script owns `packages/client/src/generated` and `packages/client/src/generated-effect`; never edit those directories directly.
- Run `./script/generate.ts` from the root for the repository-wide legacy JavaScript SDK and OpenAPI generation pipeline. Run `./packages/sdk/js/script/build.ts` only when regenerating that SDK alone.
- Commit generated output when its source contract changes, and verify the resulting diff.

## Architecture

- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol, never Core or Server; `sdk-next` composes Client, Core, and Server.

## Style

- Keep code in one function unless extraction creates reuse, composition, or a clear complex boundary.
- Prefer `const`, early returns, dot access, functional array methods, Bun APIs, and inferred types. Avoid `any`, unnecessary destructuring, `else`, and `try`/`catch` where practical.
- Never alias or star-import modules. Import an exported namespace by name when namespace-style access is needed.
- Keep heavy dynamic imports inside the narrow branch that needs them.
- In Effect generators, bind services to named variables before calling methods; do not nest service yields.
- Keep synchronous parsing and validation synchronous. Prefer Effect schema decoders over manual `JSON.parse` wrapped in `Effect.try`.
- Use snake_case Drizzle fields so column names do not need string overrides.
- Test actual behavior with minimal mocking; do not duplicate implementation logic in tests.

## V2 Session Core

Read [specs/v2/session.md](./specs/v2/session.md) before changing V2 Session behavior. Preserve these safety invariants:

- Durable prompt admission stays separate from model execution. Do not route V2 orchestration through legacy `SessionPrompt.loop(...)` or an in-memory tool loop.
- `SessionExecution` remains process-global and Session-ID based; runners, models, tools, permissions, and filesystems remain Location-scoped. No layer takes a Session ID.
- Issue exactly one explicit `llm.stream(request)` per provider turn and reload projected history before durable continuation.
- Wakes are advisory and must not retry ambiguous provider work after a crash. Event replay ownership remains separate from clustered Session execution ownership.
