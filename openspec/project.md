# Project Context

## Purpose

Opencode is an open-source, spec-driven, agentic coding platform enabling AI assistants to reliably modify, extend, and manage multi-language monorepos. It provides a unified workflow (OpenSpec) for proposing, validating, implementing, and archiving changes across CLI tooling, UI surfaces, SDKs, integrations, and automation scripts while enforcing simplicity-first engineering and predictable behavior.

## Vision

The system SHALL enable repeatable, auditable code evolution where specs are authoritative truth, changes are explicit proposals, and assistants reduce ambiguity through tightly-scoped operations. Multi-surface distribution (CLI, TUI, VSCode, Web, Slack) SHALL remain unified by the same spec corpus.

## Core Principles

- Simplicity first (prefer <100 LOC initial implementations)
- Spec before code divergence
- Provider agnostic (LLM + infrastructure)
- Deterministic tooling (avoid magic/global state)
- Composition over abstraction layering
- Small capability boundaries (10-minute understandability rule)

---

## Tech Stack

### Runtimes / Languages

- Bun (primary JS/TS runtime) — MUST be used for new JS/TS code unless strong justification
- Go (TUI and SDK components)
- TypeScript (dominant logic + tooling)
- JavaScript (lightweight scripts where types not required)
- Markdown (specs, proposals, docs)
- Astro (marketing/docs site)
- SolidJS + React (frontend surfaces)
- Shell (install / bootstrap scripts)

### Frameworks / Tooling

- SST (infrastructure orchestration on AWS + Cloudflare home)
- Turbo (monorepo task pipelining)
- Vite (frontend build)
- Astro (static site)
- OpenSpec (change/spec lifecycle)
- GitHub Actions (CI/CD)
- Husky (git hooks)
- Goreleaser (Go binary distribution)
- Stainless (SDK generation)
- Tailwind (styling)
- Zod for validation, Hono for lightweight APIs
- Stripe & PlanetScale providers via SST config

### Surfaces

| Surface          | Path                        | Stack             | Purpose                                    |
| ---------------- | --------------------------- | ----------------- | ------------------------------------------ |
| CLI              | `packages/opencode`         | Bun + TS          | Core agent execution / orchestration       |
| TUI              | `packages/tui`              | Go                | Terminal UI (migration planned to opentui) |
| Web Console      | `packages/console`          | SolidJS + Vite    | Admin / interactive interface              |
| Public Site      | `web/`                      | Astro             | Landing + docs                             |
| Desktop          | `packages/desktop`          | Web tech packaged | Local desktop experience                   |
| VSCode Extension | `sdks/vscode`               | TS                | Editor integration                         |
| Slack App        | `packages/slack`            | TS                | Chat/task integration                      |
| SDKs             | `packages/sdk/js`, `sdk/go` | TS / Go           | Programmatic access                        |

### External Integrations

- AWS (via SST abstractions)
- Cloudflare (home target)
- Stripe (payments / billing)
- PlanetScale (database provider)
- Slack API
- VSCode Extension API
- Stainless (codegen)
- Email provider (TBD in `packages/mail`)
- LLM Providers (Anthropic recommended; OpenAI, Google, local — MUST remain pluggable)

---

## Architecture Patterns

- Monorepo organized by capability-focused packages (`packages/`, `sdk/`, `sdks/`, `tui/`, `web/`)
- Specification-driven flow: `specs/` (truth) ← `changes/` (proposals) → archive
- Capability naming: verb-noun or concise domain noun — MUST avoid “AND” in description
- Cross-cutting concerns (auth, logging, telemetry) added ONLY after ≥2 concrete use cases
- Pure functions favored; side effects isolated at IO boundaries
- No hidden globals; configuration MUST be injected or read explicitly
- Go code SHALL use small interfaces; prefer composition over inheritance

---

## Directory Reference

```
openspec/
  project.md          # Conventions (this file)
  specs/              # Live capabilities (deployed behavior)
  changes/            # Proposed modifications
    [change-id]/      # Active proposal
    archive/          # Completed changes
packages/             # JS/TS packages (console, plugin, mail, etc.)
sdk/                  # Multi-language SDK tooling (Go/JS)
sdks/                 # VSCode and other surface-specific distributions
web/                  # Public site
tui/                  # Terminal UI (Go)
infra/                # Infra definition modules loaded by SST
script/               # Automation scripts
```

---

## Project Conventions

### Code Style

- Prefer one focused function/file for initial implementations (<100 new lines)
- Use `const`; avoid `let` unless mutation unavoidable
- Avoid `any`; choose precise types or `unknown`
- Early returns — minimize `else`
- Avoid unnecessary destructuring
- Keep variable names single-word descriptive
- Use Bun APIs (`Bun.file()`, `fetch`, native `serve`)
- MINIMIZE `try/catch`; prefer promise chains or localized error handling
- Inline comments sparingly — specs + naming SHOULD convey intent
- Go: small exported surface; limit package-level variables

### Error Handling

- Boundary-only: file IO, network, external service calls
- Wrap external failures with contextual messages (no raw exception leakage)
- No silent catches — MUST surface actionable messages to caller or log system

### Logging / Telemetry (Future Placeholder)

- SHALL centralize structured logs once ≥2 surfaces require cross-correlation
- Metrics/trace integration added ONLY after performance or observability trigger

### Data & Persistence

- PlanetScale (MySQL) via SST provider — schema evolution MUST be gated by spec changes
- Ephemeral caches allowed (in-memory) if rebuild safe and <10ms target read path
- No implicit persistence outside defined infra modules

### Security

- Secrets MUST NOT be committed (enforced by tooling + review)
- Stripe key via `process.env.STRIPE_SECRET_KEY`
- Least privilege AWS/IAM via SST constructs
- Authentication capabilities MUST specify scenarios before implementation
- Security-affecting changes REQUIRE proposals (even if code small)

### Performance

- Optimize ONLY after measurement (profiling or metrics)
- Add complexity triggers: >1000 concurrent sessions, >100MB dataset, >p95 >500ms
- Snapshot / golden output tests allowed for stable textual outputs (help screens, spec listings)

---

## Testing Strategy

- Behavior-first: tests reflect spec scenarios
- Unit tests colocated with logic (same directory)
- Bun test runner for TS; Go standard testing for Go code
- SHALL mock external network dependencies except explicit integration tests
- Add/modify tests when implementing ADDED or MODIFIED requirements
- REMOVED requirements generally do NOT require tests unless migration complexity
- `openspec validate --strict` MUST accompany test execution for requirement coverage
- Fast deterministic tests favored; no flaky timing dependence

### Test Layers

| Layer       | Purpose               | Example                      |
| ----------- | --------------------- | ---------------------------- |
| Unit        | Pure function logic   | parsing, formatting          |
| Integration | Cross-module behavior | CLI command uses spec loader |
| Contract    | Spec alignment        | scenario enforcement tests   |
| Golden      | Stable render output  | CLI help banner snapshot     |

---

## Git Workflow

- Branch per approved proposal (`change-id` → branch name)
- Commits: small, focused, verb-led explaining WHY
- No implementation BEFORE proposal approval
- Archive after deployment using OpenSpec tool then merge archival PR
- Pre-push hooks (format + typecheck) MUST pass
- Commit verbs: `add`, `update`, `remove`, `refactor`, `fix`, `docs`

### Commit Message Examples

- `add 2fa challenge flow`
- `refactor spec parsing for speed`
- `fix provider selection race`

---

## Change Management (OpenSpec)

- New capability / breaking / architecture / performance / security => proposal REQUIRED
- Bug fixes / typo / formatting / existing behavior tests => direct change allowed
- Each requirement MUST include ≥1 `#### Scenario:` header
- MODIFIED MUST copy full prior requirement block before editing
- RENAMED used ONLY for name changes (behavior changes must also MODIFIED)

### Scenario Formatting (Critical)

Correct:

```markdown
#### Scenario: User login success

- **WHEN** valid credentials provided
- **THEN** return JWT token
```

Wrong:

```
- **Scenario: Login**    ✗
**Scenario**: Login      ✗
### Scenario: Login      ✗
```

---

## Capability Naming

- Kebab-case
- Verb-led or domain noun (`user-auth`, `project-stats`)
- If description requires “AND” → split capability
- SHALL remain discoverable via `openspec list --specs` within minutes

---

## Contribution Guardrails

- Net-new UI / product feature MUST undergo design conversation first
- Acceptable PR types: bug fixes, LSP additions, provider support, missing standard behaviors, doc improvements
- Large multi-surface changes REQUIRE proposal
- Regenerate Stainless SDK after touching `packages/opencode/src/server/server.ts` BEFORE merging client updates

---

## Release & Distribution

- CLI install script supports prioritized env vars (`OPENCODE_INSTALL_DIR`, `XDG_BIN_DIR`)
- Multi-channel distribution: Homebrew, npm, chocolatey, scoop, Arch
- Go binaries via Goreleaser (tag-driven)
- Patched dependencies tracked under `patchedDependencies` in root `package.json`
- VSCode extension packaged from `sdks/vscode`

---

## Tasks & Automation

- Turborepo orchestrates shared tasks (`build`, `typecheck`, `opencode#test`)
- CI via GitHub Actions: publish, test, typecheck, formatting, deploy
- Husky hooks enforce local hygiene pre-push

---

## Runtime Policy

- Bun MUST be default for JS/TS execution
- Node-specific APIs added only with explicit justification (compatibility or ecosystem library)
- Go remains for TUI + performance-critical areas (subject to future migration)
- Desktop packaging SHALL reuse existing web build artifacts where possible

---

## LLM & Provider Agnosticism

- Anthropic recommended baseline; MUST not hard-code provider assumptions
- Pluggable model selection strategy
- Behavior surfaces rely on spec parsing to reduce hallucination risk

---

## External Dependencies (Detail)

| Dependency  | Purpose                   | Notes                         |
| ----------- | ------------------------- | ----------------------------- |
| Bun         | Runtime + package manager | Primary execution environment |
| SST         | Infra provisioning        | AWS + Cloudflare integration  |
| Stripe      | Billing                   | API key via env               |
| PlanetScale | DB                        | Managed MySQL                 |
| Slack API   | Chat integration          | Bot actions                   |
| VSCode API  | Editor integration        | Extension surface             |
| Stainless   | SDK gen                   | Sync after server changes     |
| Turbo       | Task pipeline             | Build/test graph              |
| Husky       | Git hooks                 | Pre-push enforcement          |
| Goreleaser  | Go release                | Binary distribution           |
| Tailwind    | Styling                   | Used in frontends             |
| Zod         | Validation                | Runtime schema checks         |
| Hono        | Lightweight HTTP          | API layer                     |

---

## Implementation Constraints

- New features initial pass <100 added LOC
- Avoid premature abstraction (extract ONLY after repetition)
- External dependency additions MUST justify performance / integration need
- All normative behavior SHALL be documented before divergence
- Performance tuning AFTER measurement (avoid speculative complexity)

---

## Validation & Tooling

- `openspec validate --strict` MUST pass before sharing proposal
- Spec parsing reliability is critical — scenario headers MUST be exact
- Use ripgrep for spec search: `rg -n "Requirement:|Scenario:" openspec/specs`
- Provide file references using `path/to/file.ts:42` format in discussions

---

## Open Questions (Placeholders)

- Telemetry collection approach (metrics + tracing) — TBD after first cross-surface need
- Secret management standardization (SSM vs custom vault) — pending scale trigger
- Unified plugin architecture across CLI + VSCode — exploration ongoing
- 2FA rollout sequence (auth capability expansion) — future proposal

---

## Quick Reference

| Artifact      | Purpose                           |
| ------------- | --------------------------------- |
| `specs/`      | Current truth                     |
| `changes/`    | Proposed modifications            |
| `archive/`    | Completed changes                 |
| `proposal.md` | Why + What                        |
| `tasks.md`    | Implementation checklist          |
| `design.md`   | Technical decisions (conditional) |
| `spec.md`     | Requirements + scenarios          |

### Essential CLI

```bash
openspec list                 # Active changes
openspec list --specs         # Capabilities
openspec show [item]          # Display spec/change
openspec validate --strict    # Validate formatting + scenarios
openspec archive <change-id> --yes  # Archive post-deploy
```

Remember: Specs are truth. Changes are proposals. Keep them in sync.
