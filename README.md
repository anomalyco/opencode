<p align="center">
  <img src="packages/ui/src/assets/brand/hero-md.webp" alt="云熙智能体 YunPat" width="280">
</p>

<p align="center">云熙智能体（YunPat）— 专利领域智能体平台，基于 <a href="https://github.com/sst/opencode">OpenCode</a>（MIT）二次开发。</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

---

## Attribution

This repository is an independent fork. It is **not** affiliated with or maintained by the OpenCode / SST team.
See [NOTICE](NOTICE) and [LICENSE](LICENSE).

Upstream reference (read-only): `https://github.com/sst/opencode.git`

---

## What is in this repo

Patent-focused monorepo core:

- `packages/opencode` — CLI / server engine
- `packages/opencode-patent-plugin` — patent workflows
- `packages/app` + `packages/ui` — web UI
- `packages/desktop` — Electron desktop (macOS / Windows / Linux)
- `packages/core`, `packages/sdk`, `packages/plugin`, `packages/script`

Non-core upstream packages (console, docs site, infra, GitHub Action, etc.) live under `archive/`.

---

## Development

From the repository root:

```bash
bun install
```

**CLI / server**

```bash
bun run dev
# or: bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096
```

**Web UI** (separate terminal)

```bash
bun run dev:web
# open http://localhost:4444 — expects server at http://localhost:4096
```

**Desktop** (Electron)

```bash
bun run dev:desktop
```

Typecheck (from root):

```bash
bun typecheck
```

Tests run from package directories (not the repo root). Example:

```bash
cd packages/opencode && bun test
```

---

## Configuration

- Project agents: `.yunpat-agent/` (recommended)
- Legacy OpenCode env vars (`OPENCODE_*`) are still honored by the engine
- LLM providers: use your own API keys in config — **no opencode.ai account required** for local dev

See [docs/independence.md](docs/independence.md) for runtime dependencies and internal testing.

---

## Desktop internal testing (no Apple Developer account)

Build an unsigned macOS app for a small pilot (e.g. 4 machines):

```bash
cd packages/desktop
bun run build
bun run package:mac
```

Testers: right-click the app → **Open** on first launch, or run `xattr -cr /path/to/YunPat.app`.

---

## Repository

GitHub 仓库名：`yunpat-ts`（与 npm/产品名 `yunpat` 区分）

https://github.com/xujian519/yunpat-ts
