# GEMINI.md

## Project Overview
OpenCode is an open-source AI coding agent designed to be provider-agnostic and terminal-first. It provides a powerful Text User Interface (TUI), a Desktop application, and a client-server architecture that allows for remote operation.

### Main Technologies
- **Runtime:** [Bun](https://bun.sh/) (1.3+)
- **Languages:** TypeScript
- **UI Frameworks:** [SolidJS](https://www.solidjs.com/) (Web/App), [opentui](https://github.com/sst/opentui) (TUI)
- **Infrastructure:** [SST](https://sst.dev/) (Ion), Cloudflare (Home), Planetscale (DB)
- **Desktop:** [Tauri](https://tauri.app/) (v2)
- **AI Integration:** [Vercel AI SDK](https://sdk.vercel.ai/docs), various providers (Anthropic, OpenAI, Google, etc.)
- **Monorepo Tooling:** [Turborepo](https://turbo.build/)

### Architecture
OpenCode is organized as a monorepo under the `packages/` directory:
- `packages/opencode`: Core business logic, server, and TUI implementation.
- `packages/app`: Shared web UI components (SolidJS).
- `packages/desktop`: Native desktop application built with Tauri (wraps `packages/app`).
- `packages/console`: Management console and dashboard.
- `packages/sdk`: SDKs for interacting with OpenCode (JS/TS).
- `infra/`: Infrastructure definitions using SST.
- `specs/`: Project specifications and API definitions.

## Building and Running

### Prerequisites
- Bun 1.3 or higher.
- (Optional) Rust toolchain and platform-specific dependencies for Desktop development.

### Key Commands
- **Install Dependencies:** `bun install`
- **Start Core Agent (TUI):** `bun dev` (runs in `packages/opencode`)
- **Run Agent against a Directory:** `bun dev <path-to-directory>`
- **Run Web UI Dev Server:** `bun run --cwd packages/app dev`
- **Run Desktop App (Dev Mode):** `bun run --cwd packages/desktop tauri dev`
- **Build Desktop App:** `bun run --cwd packages/desktop tauri build`
- **Regenerate SDK & API:** `bun run script/generate.ts`
- **Typecheck Workspace:** `bun turbo typecheck`
- **Run Tests:** `bun run --cwd packages/opencode test` (Note: do not run tests from the root)
- **Build Standalone Executable:** `./packages/opencode/script/build.ts --single`

## Development Conventions

### Coding Style (from STYLE_GUIDE.md)
- **Prefer `const` over `let`:** Avoid `let` statements and mutability.
- **No `else` statements:** Use early returns or IIFEs to simplify control flow.
- **Single Word Naming:** Strive for single-word identifiers for variables and functions (e.g., `const foo = 1`).
- **Minimal Functionality:** Keep logic within a single function unless there is a clear benefit to composition or reuse.
- **Avoid Destructuring:** Prefer direct property access (e.g., `obj.prop`) to maintain context unless destructuring is necessary.
- **Bun APIs:** Use Bun-specific helpers like `Bun.file()` when applicable.
- **Error Handling:** Prefer `.catch()` over `try/catch` where possible.
- **Types:** Use precise types; avoid `any`.

### Contribution Guidelines (from CONTRIBUTING.md)
- **Issue First:** All PRs must reference an existing issue (e.g., `Fixes #123`).
- **Conventional Commits:** Use standard titles like `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- **Parallelism:** When using AI tools or writing logic, prioritize parallel execution where applicable.
- **Design Review:** Any UI or core product features must be reviewed by the core team before implementation.

### Branching
- The default branch for development is `dev`.
