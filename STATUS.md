# Cedric Development Status

**Date:** June 14, 2026
**Canonical root:** `/Users/julien/Documents/Cedric`
**Branch:** `dev`

## Current Summary

Cedric now has a functional multi-tab workspace foundation: browser tabs, review, markdown files, code files, terminal tabs, Side Chat tabs, persisted tab state, tab shortcuts, and tab context menus are in place. Terminal tab desktop create/render/command execution, restore, resize, paste, copy, and close smoke now pass. Side Chat desktop send, actual model-response smoke, and Browser-to-Side-Chat actual model-response smoke now pass through the local Kimi bridge provider. The primary user-facing desktop branding pass is complete; remaining OpenCode references are compatibility, migration, E2E fixture, or upstream-contract references. Browser annotation capture, persistence, listing, removal, and Side Chat / main-chat handoff are now implemented. Desktop browser automation now uses explicit active-webview registration for navigate/content/screenshot capture, clears stale inactive webviews, waits for page readiness before capture/content reads, and has a fresh-start live smoke for content plus screenshot capture. Background Tasks v1 now surfaces task-tool child sessions with status, view, stop/dismiss, retry, and merge-result actions in the current session surface and legacy sidebar. It consumes typed `background.job.updated` lifecycle events while jobs are live, persists observable task-job snapshots onto child-session metadata, reports orphaned running snapshots as restart-stopped instead of pretending they are still active after a process restart, carries partial successful output plus numeric progress while extended background work remains running, explicitly retries restart-orphaned durable task sessions in the same child session with the stored model, automatically claims retryable orphaned tasks during app directory bootstrap, and uses live child assistant text as running detail when provider-turn part updates are present. Agent-initiated workspace actions v1 is wired through a typed `workspace.action.requested` event and the app can open file, browser, and terminal workspace tabs for the active session. The internal scoped package rename from the old OpenCode package scope to `@cedric/*` is complete across workspace manifests, imports, turbo task keys, lockfiles, docs, and package-local validation; the unscoped `opencode` CLI/runtime contract remains where compatibility requires it. No remaining core workspace or package-readiness smoke blockers are known after the local Kimi bridge fix and scoped package rename.

## Completed

- Canonical repo consolidated at `/Users/julien/Documents/Cedric`.
- App and desktop package validation restored after the merge cleanup.
- Cedric docs and setup guides normalized from the prior OpenKimi/OpenCode split.
- Moonshot/Kimi provider path added under `packages/llm`.
- Context optimizer and computer-control tool surfaces added.
- `computer_use` screenshot attachments now use normal file-part data URLs, restoring `packages/opencode` typecheck.
- Multi-tab workspace shell added.
- Browser tabs support multiple instances.
- Markdown viewer added for markdown file tabs.
- Code viewer added for non-markdown files with Shiki highlighting, line numbers, copy, wrap, and search.
- Terminal workspace tab added on top of the existing PTY API, Ghostty renderer, and terminal state store.
- Side Chat workspace tab added with independent session-backed text conversations, optimistic sends, abort support, per-tab agent/model/variant controls, browser URL/title handoff, file handoff, main-chat draft copy, and persisted backing session IDs.
- Browser annotations added for browser tabs: selected text highlights, freeform notes, per-page filtering, persisted tab state, deletion, annotation drawer, Side Chat synthetic context, and main-chat prompt handoff.
- Browser automation capture reliability hardened: active browser webviews are registered/cleared explicitly, stale inactive tabs no longer remain the automation target, navigation waits for active registration, and content/screenshot actions wait for document readiness before reading/capturing.
- Desktop browser automation live smoke passed from a fresh onboarding desktop run: deep-link to a temporary project, navigate an embedded Browser tab to a local HTTP page, read marker content, and capture a screenshot through the automation endpoint.
- Background Tasks v1 added for task-tool child sessions: task discovery from session parts, live-ish queued/running/completed/failed status, view child conversation, stop/dismiss actions, and merge-result handoff to the parent chat.
- Background Tasks now has a typed experimental backend job listing endpoint plus event-driven app sync through `background.job.updated`, so live task job completion, failure, cancellation, timestamps, and output can update the task list before parent result injection catches up.
- Background Tasks now persists observable task-job snapshots onto child-session metadata and merges them into the backend listing, so restart orphaned running snapshots show as stopped/failed instead of staying indefinitely active.
- Background Tasks now emits partial successful output and numeric progress while extended task-job work is still running; the app shows that as running detail without enabling final result merge until completion.
- Background Tasks now marks restart-orphaned durable running snapshots as retryable, exposes a typed retry endpoint, resumes the same child session with the stored provider/model, persists the completed recovered result, injects the recovered task result back into the parent thread, shows a retry action in the Background Tasks panel, and automatically retries retryable orphaned jobs during app directory bootstrap.
- Background Tasks now prefers live child assistant text as running detail when provider-turn part updates are already present in the app store, giving the panel finer-grained progress than task-job stage output alone.
- Agent-initiated workspace actions v1 added: the `workspace` tool requests app-visible file, browser, and terminal tabs through a typed `workspace.action.requested` event, and the session side panel opens those actions only for the matching active session.
- Workspace tabs persist per server/workspace scope and recover invalid persisted state.
- Tab ergonomics added: drag reorder, pin/unpin, duplicate, close others, close all, reopen closed tab, and standard shortcuts.
- Internal scoped package rename completed from the old OpenCode package scope to `@cedric/*` across package names, workspace dependencies, imports, turbo task keys, lockfiles, docs, and local validation fixtures. Console package `sst` declarations and stale local Kimi LLM sample scripts were cleaned up so package-level typechecks pass.

## Remaining Development

- No remaining core workspace or package-readiness development blockers are currently known.
- Remaining work is release preparation: inspect the large diff, stage coherent changes, write the conventional commit/PR notes, and optionally run a final fresh desktop smoke before publishing.

## Validation Baseline

Use package-level validation. Do not run tests from the repo root.

```bash
cd packages/app && bun typecheck
cd packages/app && bun test
cd packages/app && bun run build
cd packages/desktop && bun typecheck
cd packages/desktop && bun run build
git diff --check
```

Most recent app-slice validation:

- `cd packages/app && bun typecheck` passed.
- Targeted `oxlint` on the workspace tab/Side Chat/browser/file/main-chat handoff files passed.
- `cd packages/app && bun test` passed with 389 tests and 995 assertions.
- `cd packages/app && bun run build` passed with known Vite/chunk-size warnings.
- `cd packages/desktop && bun typecheck` passed.
- `cd packages/desktop && bun run build` passed with known Electron/Vite warnings.
- `git diff --check` passed.
- Previous local web smoke opened `http://localhost:4444` against the dev backend and rendered the Cedric new-session and saved-session surfaces with no browser console errors. A blank smoke session created for the route check was deleted afterward.
- Current in-app Browser smoke loaded the local app, but deeper click/screenshot automation timed out and the tab reported `global-sdk` event-stream errors, so it was not used as the final Side Chat interaction signal.
- Side Chat controls smoke opened a temporary saved-session route, used the workspace new-tab palette to create a Side Chat tab, and verified the per-tab agent/model controls plus composer in system Chrome with no console errors. The temporary smoke session was deleted afterward.
- Browser handoff smoke opened a temporary saved-session route, created a Browser tab, used `Send page to Side Chat`, and verified the new Side Chat composer plus removable browser context chip in system Chrome with no console errors. The temporary smoke session was deleted afterward.
- Focused request-builder tests cover synthetic browser context parts, and browser tabs can now open a fresh Side Chat with the current page URL/title attached as removable synthetic context.
- Focused file-handoff validation passed: `cd packages/app && bun typecheck`, focused request-builder/workspace-tab tests, targeted `oxlint` on Side Chat/file viewer/prompt-input files, and `git diff --check`.
- File handoff smoke opened a temporary saved-session route, loaded `STATUS.md` as a workspace file tab in a temporary Chrome profile, clicked `Send file to Side Chat`, and verified the new Side Chat composer plus removable file context chip with no console/page errors. The temporary smoke session was deleted afterward.
- Focused main-chat handoff validation passed: request-builder, workspace-tab, and prompt-submit tests passed directly with 24 tests and 88 assertions.
- Main-chat handoff smoke opened a temporary saved-session route, verified `Send file to Main Chat` adds a main composer file-context chip, `Send page to Main Chat` inserts browser title/URL text into the main composer, and `Copy draft to Main Chat` copies a Side Chat draft into the main composer with no console/page errors. The temporary smoke session was deleted afterward.
- Desktop Terminal smoke opened a new session in the Kimi Test project, created a fresh workspace Terminal tab from the palette, verified Ghostty rendered a visible canvas/textarea, sent a generated marker command through the live PTY, and captured visible terminal output in `/tmp/cedric-terminal-smoke-final.png`. The earlier recursive title/state update loop was fixed by skipping no-op workspace tab updates.
- Desktop Terminal restore/close smoke launched with stale persisted PTY ids, recovered a stale active tab into a new live PTY before mounting Ghostty, sent a generated marker through the recovered terminal, closed the active Terminal tab through the workspace shortcut path, and verified the closed PTY id disappeared from the sidecar.
- Desktop Terminal resize smoke resized the Electron window with `window.resizeTo(...)`, verified the Ghostty canvas dimensions refit, and restored the window size.
- Desktop Terminal paste smoke dispatched a clipboard paste into the visible Terminal tab, pressed Enter, and verified the pasted generated marker command returned through the live PTY.
- Desktop Terminal copy smoke opted the compiled renderer into the terminal E2E handle, selected visible Ghostty terminal lines, ran `document.execCommand("copy")`, and verified `pbpaste` contained the generated marker `CEDRIC_COPY_1781369606345`.
- Desktop Side Chat send smoke opened a new saved-session route, used the visible workspace New Tab palette to create a new Side Chat tab, sent marker `CEDRIC_SIDE_CHAT_SEND_1781369791175`, verified the composer draft cleared, and saw the user message rendered in the Side Chat transcript.
- Earlier Desktop Side Chat provider-response smoke with the persisted cloud `Kimi K2.7 Code` selection reached an assistant error bubble with `Invalid Authentication`; that blocker was resolved by routing the Cedric project to the local Kimi bridge provider below.
- Local Kimi bridge provider config was added as `kimi-local` with slash-safe model keys for `kimi-for-coding` and `kimi-for-coding-thinking`, mapping to bridge API IDs `kimi-code/kimi-for-coding` and `kimi-code/kimi-for-coding,thinking`.
- Direct bridge smoke passed: `curl http://127.0.0.1:8767/v1/models` returned both expected local models, and a direct chat completion returned `CEDRIC_KIMI_BRIDGE_OK`.
- opencode CLI smoke passed from `packages/opencode`: `run --dir /Users/julien/Documents/Cedric -m kimi-local/kimi-for-coding` returned `CEDRIC_OPENCODE_LOCAL_OK`.
- Desktop Side Chat actual model-response smoke passed in the Cedric project: the app was opened through the native deep-link path, the Side Chat tab selected `Kimi for Coding`, marker `CEDRIC_SIDE_CHAT_LOCAL_1781370723883` was sent, the assistant returned `CEDRIC_SIDE_CHAT_LOCAL_1781370723883_RESPONSE`, and no `Invalid Authentication` or `APIError` surfaced.
- Browser-to-Side-Chat actual model-response smoke passed in the Cedric project: a Browser tab opened `https://example.com`, `Send page to Side Chat` created a contextual Side Chat with `example.com` present, marker `CEDRIC_BROWSER_SIDE_CHAT_LOCAL_1781371116279` was sent through the visible contextual Side Chat, the assistant returned `CEDRIC_BROWSER_SIDE_CHAT_LOCAL_1781371116279_RESPONSE`, and no `Invalid Authentication` or `APIError` surfaced.
- Focused post-provider validation passed: `cd packages/app && bun typecheck`, `cd packages/app && bun test src/context/workspace-tabs.test.ts`, `cd packages/desktop && bun typecheck`, and `git diff --check`. Targeted `bunx oxlint packages/app/src/components/terminal.tsx` reported 0 errors and the same 6 warnings already present in that file.
- Focused branding cleanup passed: desktop renderer title is `Cedric`, Linux metainfo generation emits Cedric product/app IDs, desktop updater locale strings no longer expose OpenCode, WSL user-facing failure text says Cedric CLI while preserving the `opencode` command contract, and channel/startup env handling accepts `CEDRIC_*` first while retaining `OPENKIMI_*` and `OPENCODE_*` compatibility.
- Focused branding validation passed: `cd packages/app && bun test src/wsl/settings-model.test.ts`, `cd packages/desktop && bun test src/main/wsl/servers.test.ts`, `cd packages/app && bun typecheck`, `cd packages/desktop && bun typecheck`, `cd packages/app && bun run build`, `cd packages/desktop && bun run build`, and `git diff --check`.
- Focused browser annotation validation passed: `cd packages/app && bun test --preload ./happydom.ts ./src/components/tabs/browser-tab.test.ts ./src/context/workspace-tabs.test.ts ./src/components/prompt-input/build-request-parts.test.ts`, `cd packages/app && bun typecheck`, `cd packages/app && bun run build`, and `git diff --check`.
- Browser annotation e2e coverage was added and passed: `cd packages/app && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run test:e2e:local e2e/regression/browser-annotations.spec.ts`. The normal managed Playwright browser path still expects Chromium revision `1217`; the local cache only had revision `1223`, and `bunx playwright install chromium-headless-shell` stalled after download without registering the executable. `packages/app/playwright.config.ts` now supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_CHROMIUM_CHANNEL` as local fallback overrides.
- In-app Browser local smoke opened `http://127.0.0.1:3000/.../session/ses_browser_annotation_smoke` against a temporary mock API, rendered title `Cedric`, and reported no warning/error console logs. Annotation-specific seeding through a `javascript:` URL was blocked by Browser Use policy, so that path was not used as validation.
- Focused Background Tasks validation passed: `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/components/tabs/browser-tab.test.ts ./src/context/workspace-tabs.test.ts`, `cd packages/app && bun typecheck`, `cd packages/app && bun run build`, and `cd packages/app && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run test:e2e:local e2e/regression/background-tasks.spec.ts`.
- Focused browser automation reliability validation passed: `cd packages/desktop && bun test src/main/browser-automation.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/components/tabs/browser-tab.test.ts ./src/context/workspace-tabs.test.ts`, `cd packages/app && bun typecheck`, `cd packages/desktop && bun typecheck`, `cd packages/core && bun typecheck`, `cd packages/app && bun run build`, `cd packages/desktop && bun run build`, and `git diff --check`.
- Focused browser automation live validation passed: fresh desktop onboarding run on `CEDRIC_PORT=17892`, deep-linked temporary project, Browser tab navigated to `http://127.0.0.1:58084/smoke`, `getContent` returned marker `CEDRIC_BROWSER_FINAL_FRESH_SMOKE`, screenshot captured at `1200x1308`, and the smoke server saw exactly one page request.
- Final cleanup validation passed: `cd packages/app && bun test --preload ./happydom.ts ./src/components/tabs/browser-tab.test.ts ./src/context/workspace-tabs.test.ts ./src/pages/session/session-side-panel.test.ts`, `cd packages/desktop && bun test src/main/browser-automation.test.ts`, `cd packages/app && bun typecheck`, `cd packages/desktop && bun typecheck`, `cd packages/core && bun typecheck`, `cd packages/app && bun run build`, `cd packages/desktop && bun run build`, and `git diff --check`.
- Focused Background Tasks backend lifecycle validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/context/global-sync/bootstrap.test.ts`, `cd packages/app && bun typecheck`, `cd packages/opencode && bun test test/server/httpapi-experimental.test.ts`, `cd packages/opencode && bun typecheck`, `cd packages/app && bun run build`, and `git diff --check`.
- Focused Background Tasks event-driven lifecycle validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/core && bun test test/background-job.test.ts`, `cd packages/opencode && bun test test/background/job.test.ts test/server/httpapi-experimental.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/context/global-sync/event-reducer.test.ts ./src/components/background-tasks.test.ts`, `cd packages/core && bun typecheck`, `cd packages/opencode && bun typecheck`, and `cd packages/app && bun typecheck`.
- Focused Background Tasks restart-aware snapshot validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/core && bun test test/background-job.test.ts`, `cd packages/opencode && bun test test/background/job.test.ts test/server/httpapi-experimental.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/context/global-sync/event-reducer.test.ts`, `cd packages/core && bun typecheck`, `cd packages/opencode && bun typecheck`, and `cd packages/app && bun typecheck`.
- Focused workspace actions validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/opencode && bun test test/tool/workspace.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/pages/session/workspace-actions.test.ts ./src/context/workspace-tabs.test.ts`, `cd packages/opencode && bun typecheck`, `cd packages/app && bun typecheck`, `cd packages/app && bun run build`, and `git diff --check`.
- Focused Background Tasks partial progress validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/core && bun test test/background-job.test.ts`, `cd packages/opencode && bun test test/background/job.test.ts test/tool/workspace.test.ts`, `cd packages/opencode && bun test test/server/httpapi-experimental.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/pages/session/workspace-actions.test.ts ./src/context/workspace-tabs.test.ts`, `cd packages/core && bun typecheck`, `cd packages/opencode && bun typecheck`, `cd packages/app && bun typecheck`, `cd packages/app && bun run build`, and `git diff --check`.
- Focused Background Tasks retry/recovery/streaming-detail validation passed: `./packages/sdk/js/script/build.ts`, `cd packages/opencode && bun test test/background/job.test.ts test/server/httpapi-experimental.test.ts test/tool/workspace.test.ts`, `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/context/global-sync/bootstrap.test.ts ./src/pages/session/workspace-actions.test.ts ./src/context/workspace-tabs.test.ts`, `cd packages/core && bun test test/background-job.test.ts`, `cd packages/core && bun typecheck`, `cd packages/opencode && bun typecheck`, `cd packages/app && bun typecheck`, `cd packages/app && bun run build`, and `git diff --check`.
- Scoped package rename validation passed: `bun install`, `./packages/sdk/js/script/build.ts`, no old scoped package matches in source/docs under the ignored-artifact filter, focused background/workspace tests in `packages/core`, `packages/opencode`, and `packages/app`, `cd packages/app && bun run build`, `cd packages/desktop && bun run build`, and `git diff --check`.
- Declared package typecheck sweep passed from package directories: `packages/app`, `packages/core`, `packages/opencode`, `packages/desktop`, `packages/ui`, `packages/sdk/js`, `packages/server`, `packages/cli`, `packages/plugin`, `packages/llm`, `packages/http-recorder`, `packages/slack`, `packages/enterprise`, `packages/console/app`, `packages/console/core`, `packages/console/function`, `packages/console/support`, `packages/stats/app`, `packages/stats/core`, `packages/stats/server`, `packages/effect-sqlite-node`, and `packages/effect-drizzle-sqlite`.

Still pending:

- No remaining core workspace or package-readiness smoke blockers are known after the local Kimi bridge fix and scoped package rename.

## Next Tranche

1. Prepare the review package: inspect the large diff, stage coherent changes, and draft conventional commit/PR notes.
2. Run one final fresh desktop smoke before publishing if the release path needs a live interaction check.
