# Desktop Startup Hardening

## Goal

Harden desktop startup so failures are surfaced explicitly instead of hanging forever, crashing the app, or revealing a broken UI before the backend is actually usable.

## Problem Summary

Current startup review found several confirmed failure modes:

- Fresh installs can hang forever if the sidecar exits before SQLite migration emits `done`.
- Direct sidecar spawn failures still panic the desktop app during initialization.
- Existing installs can reveal the main UI even when the local sidecar is already dead.
- The startup shell currently relies on a 12 second timeout and can hide too early or mask the wrong failure.
- Desktop can start against the local sidecar before the persisted default server has loaded, which breaks remote-server startup semantics.
- Windows WSL startup settings are persisted but never actually restored.

## Product Principles

- Do not crash the desktop app on startup for recoverable backend failures.
- Do not leave users in an infinite loading state with no error or recovery path.
- Do not reveal the interactive app until startup state is internally consistent.
- Preserve fast startup for healthy local sidecar cases.
- Keep remote-server health behavior correct and explicit.

## Required Behavior

- Sidecar spawn failure must surface as a handled startup error, not a process abort.
- First-run SQLite gating must terminate on sidecar death, startup timeout, or explicit startup failure.
- The loading window and startup shell must have explicit failure states, not success-only signaling.
- The startup shell must not auto-hide on a blind timer if readiness was never reached.
- Desktop must not commit to sidecar health-gating assumptions until the persisted default server decision is known.
- Local-sidecar startup may remain optimized, but only if failure states still become visible to the user.
- Windows WSL startup configuration must actually round-trip through persistence and affect startup behavior.

## Non-Goals

- Do not redesign the loading window or startup shell visuals beyond what is needed for error and retry states.
- Do not remove remote HTTP health checks.
- Do not change unrelated updater, OpenClaw, or menu behavior unless directly required by startup correctness.

## Candidate Work Areas

- Native startup state machine in `packages/desktop/src-tauri/src/lib.rs`
- Sidecar spawn and shell environment handling in `packages/desktop/src-tauri/src/cli.rs`
- Health-check and termination coordination in `packages/desktop/src-tauri/src/server.rs`
- Main-window/startup-shell coordination in `packages/desktop/src/index.tsx`
- Loading route error handling in `packages/desktop/src/loading.tsx`
- App readiness signaling in `packages/app/src/app.tsx`
- Home/layout interactive readiness signaling in `packages/app/src/pages/home.tsx` and `packages/app/src/pages/layout.tsx`
- Default server selection timing in `packages/app/src/context/server.tsx`
- Windows WSL startup config behavior in `packages/desktop/src-tauri/src/server.rs` and `packages/desktop/src-tauri/src/windows.rs`

## Relevant Files

- `packages/desktop/src-tauri/src/lib.rs`
- `packages/desktop/src-tauri/src/cli.rs`
- `packages/desktop/src-tauri/src/server.rs`
- `packages/desktop/src-tauri/src/windows.rs`
- `packages/desktop/src-tauri/src/main.rs`
- `packages/desktop/src/loading.tsx`
- `packages/desktop/src/index.tsx`
- `packages/app/src/app.tsx`
- `packages/app/src/pages/home.tsx`
- `packages/app/src/pages/layout.tsx`
- `packages/app/src/context/server.tsx`
- `packages/desktop/src-tauri/src/os/windows.rs`

## Verification

- Missing or non-executable sidecar no longer crashes desktop startup.
- Fresh install with sidecar startup failure no longer hangs forever on the loading window.
- Existing install with sidecar failure surfaces a clear startup error instead of showing a broken app shell.
- Startup shell remains visible until a real ready or explicit failure state is reached.
- Remote default server startup does not incorrectly skip blocking health gating because sidecar won an earlier race.
- Windows WSL enablement survives restart and actually selects the WSL startup path.
- macOS and Windows startup still succeed in the healthy local-sidecar path without a noticeable regression in startup latency.
