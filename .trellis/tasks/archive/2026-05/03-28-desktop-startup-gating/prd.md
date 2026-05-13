# Desktop Startup Gating

## Goal

Make desktop startup obey the rule "show the startup shell early, hide it late" so the native loading window only covers the pre-webview gap, while first-interaction readiness is still protected by explicit startup signals.

## Product Principle

- Do not reveal the real desktop app before the first mouse or keyboard input should respond immediately.
- Keep SQLite migration as a hard gate when the local database still needs to be created.
- Let the hidden main window plus HTML startup shell absorb waits that are not required for first-input correctness.

## Required Behavior

- The native loading window may block only until the hidden main window can safely be shown.
- The main window should become visible immediately after SQLite migration gating is satisfied.
- The HTML startup shell should remain visible until the app emits `opencode:startup-interactive`.
- Desktop local sidecar startup must not pay a second blocking health gate inside `ConnectionGate`.
- Home-page warm prefetch must continue as a background optimization and must not delay `startup-interactive`.

## Non-Goals

- Do not remove remote-server health checks.
- Do not remove SQLite migration progress handling.
- Do not redesign the startup shell visuals beyond what is needed for gating correctness.

## Relevant Files

- `packages/desktop/src-tauri/src/lib.rs`
- `packages/desktop/src/index.tsx`
- `packages/desktop/index.html`
- `packages/desktop/src/loading.tsx`
- `packages/app/src/app.tsx`
- `packages/app/src/pages/home.tsx`
- `packages/app/src/pages/layout.tsx`

## Verification

- Desktop startup shows the main window as soon as the startup shell can paint, not only after sidecar health finishes.
- Existing startup shell still hides only after `opencode:startup-interactive`.
- Home route dispatches `opencode:startup-interactive` as soon as sync is ready, without waiting for warm prefetch completion.
- Web entry behavior remains unchanged.
