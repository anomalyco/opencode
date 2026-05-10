# Integrated Browser Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop integrated browser a real agent-usable tool, controlled by a user setting, and make `/browser` provide task context instead of acting primarily as a URL opener.

**Architecture:** Desktop owns the integrated browser, so desktop must expose browser operations through a local internal tool bridge that the opencode tool layer can register only when the desktop client setting is enabled. `/browser` becomes a contextual prompt directive: it keeps the user's task text and strongly instructs the agent to use integrated browser tools first. The Settings UI adds a Browser section with a default-on toggle that gates tool registration and `/browser` behavior.

**Tech Stack:** Electron main process, opencode ToolRegistry/MCP-compatible tool layer, SolidJS settings UI, Bun tests, package-level `bun typecheck`.

---

## File Structure

- `packages/desktop/src/main/browser/BrowserManager.ts` — existing browser operations to wrap as tools.
- `packages/desktop/src/main/browser/agent-tools.ts` — new focused module exposing browser tool definitions/handlers from BrowserManager.
- `packages/desktop/src/main/browser/agent-tools.test.ts` — tests for tool definitions and handler delegation.
- `packages/opencode/src/tool/registry.ts` or adjacent browser tool module — register integrated browser tools when desktop setting/client is enabled.
- `packages/opencode/src/tool/browser.ts` — new tool definitions if existing registry pattern supports a separate module.
- `packages/app/src/components/prompt-input/browser-command.ts` — change `/browser` parsing to context mode, not URL-command mode.
- `packages/app/src/components/prompt-input/submit.ts` — submit `/browser <task>` as a normal prompt with browser-context metadata/hint, not silent local-only navigation.
- `packages/app/src/components/prompt-input/build-request-parts.ts` — strong bounded integrated-browser priority hint.
- `packages/app/src/pages/session/use-session-commands.tsx` — `/browser` command registration remains local insert command.
- Settings files under `packages/app/src/components/dialog-settings*` or existing settings modules — add Browser section/toggle.
- Config files under `packages/opencode/src/config` / app settings store — persist `browser.integratedTools.enabled` defaulting to true.

---

### Task 1: Convert `/browser` into context mode

**Files:**
- Modify: `packages/app/src/components/prompt-input/browser-command.ts`
- Modify: `packages/app/src/components/prompt-input/browser-command.test.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.test.ts`

- [x] Add failing parser tests proving `/browser facebook.com`, `/browser investigá facebook`, and `/browser abrir facebook.com y revisar login` return a context payload, not a URL-only local command.
- [x] Add failing submit tests proving `/browser <task>` calls the normal prompt path exactly once and does not silently clear the task after only opening the panel.
- [x] Keep bare `/browser` local: it opens/provisions the BrowserPanel and inserts/keeps context for the next prompt without submitting an empty task.
- [x] Update hint text to say: integrated browser tools are available and should be preferred over Playwright/external browsers for navigation, inspection, screenshots, console, and page interaction.
- [x] Run from `packages/app`: `bun test --preload ./happydom.ts ./src/components/prompt-input/browser-command.test.ts ./src/components/prompt-input/submit.test.ts ./src/components/prompt-input/build-request-parts.test.ts`.

### Task 2: Add persisted Browser setting, default on

**Files:**
- Modify/create config module under `packages/opencode/src/config` following repo self-export pattern.
- Modify settings UI files under `packages/app/src/components/dialog-settings*`.
- Test: relevant config/settings tests, or add focused tests if none exist.

- [x] Add failing config test proving `browser.integratedTools.enabled` defaults to `true` when unset.
- [x] Add failing settings UI test proving Settings contains a Browser/Navegador section with a toggle for integrated browser agent tools.
- [x] Persist toggle changes using existing settings/config mechanisms.
- [x] Disabled state copy must be clear: when off, the agent will not receive integrated browser tools automatically.
- [x] Run from relevant package dirs: focused settings/config tests and `bun typecheck`.

### Task 3: Expose integrated browser operations as real tool definitions

**Files:**
- Create: `packages/desktop/src/main/browser/agent-tools.ts`
- Create: `packages/desktop/src/main/browser/agent-tools.test.ts`
- Modify: `packages/desktop/src/main/browser/BrowserManager.ts` only if existing methods need small wrappers.
- Modify: opencode tool registry/browser tool module discovered in Task 2/implementation exploration.

- [x] Add failing tests that tool definitions exist for navigation, snapshot/inspect, click, type, screenshot, console read, console clear, back, forward, and reload.
- [x] Add failing tests that each tool delegates to the integrated BrowserManager path rather than Playwright/Chrome.
- [x] Register these tools only when desktop client and `browser.integratedTools.enabled === true`.
- [x] Tool descriptions must explicitly say they operate on the OpenCode integrated browser.
- [x] Tool names must be distinct from Playwright and stable, e.g. `browser.navigate`, `browser.inspect`, `browser.click`, `browser.type`, `browser.screenshot`, `browser.console_messages`, `browser.console_clear` if the registry supports dotted names; otherwise use stable MCP-safe names and map descriptions clearly.
- [x] Run from `packages/desktop`: `bun test src/main/browser/agent-tools.test.ts src/main/browser/BrowserManager.test.ts` and `bun typecheck`.
- [x] Run from opencode package dir: focused tool registry tests and `bun typecheck`.

### Task 4: Gate tools and `/browser` behavior by setting

**Files:**
- Modify: settings/config files from Task 2.
- Modify: prompt-input files from Task 1.
- Modify: registry/tool files from Task 3.
- Test: app submit/build-request-parts tests and tool registry tests.

- [x] Add failing tests proving when setting is disabled, integrated browser tools are not registered/exposed to the model.
- [x] Add failing tests proving `/browser <task>` warns or injects a disabled-state/unavailable message instead of claiming tools are available.
- [x] Ensure when setting is enabled, `/browser <task>` produces the browser-priority hint and tool registration is active.
- [x] Run focused app, desktop, and opencode tests.

### Task 5: Final verification and installer

**Files:**
- Verify source; rebuild installer after all tests pass.

- [x] Run app focused tests for prompt input and settings.
- [x] Run desktop browser tool tests.
- [x] Run opencode tool registry/config tests.
- [x] Run `bun typecheck` from affected package dirs only.
- [x] Run from `packages/desktop`: `$env:OPENCODE_CHANNEL='dev'; bun run build; if ($?) { bun run package:win }`.
- [x] Confirm installer exists at `packages/desktop/dist/opencode-desktop-win-x64.exe`.

> Installer rebuild was explicitly approved by the user and completed successfully.

---

## Design Notes

- `/browser` is not primarily URL navigation. It means “for this task, use the integrated browser context/tools”.
- URL-looking text after `/browser` is task content, not a local-only command. The agent receives it and should use integrated browser tools to act on it.
- The setting is default-on because the desktop app’s integrated browser is a primary feature, but users can disable it when they prefer external/MCP/Playwright tooling.
- Prompt hints are still useful, but they are not enough. The model needs actual tool definitions for reliable behavior.
