# DESKTOP KNOWLEDGE BASE

## OVERVIEW

`packages/desktop` is Tauri v2 shell + Vite frontend wrapping shared app/ui packages.

## WHERE TO LOOK

- Frontend entry: `packages/desktop/src/index.tsx`
- Native backend: `packages/desktop/src-tauri/src/lib.rs`
- Tauri config: `packages/desktop/src-tauri/tauri.conf.json`
- Build preparation: `packages/desktop/scripts/prepare.ts`

## CONVENTIONS

- Local web-only dev: `bun run --cwd packages/desktop dev`.
- Native dev/build: `bun run --cwd packages/desktop tauri dev|build`.
- `tauri.conf.json` runs `beforeDevCommand` and `beforeBuildCommand` via Bun scripts.
- Release pipeline expects Rust toolchain and signing secrets.

## ANTI-PATTERNS

- Don’t treat desktop as web-only package; Rust/Tauri paths matter.
- Don’t edit generated release artifacts in workflow outputs.
- Don’t change bundle targets/icons casually; CI/release depends on them.
