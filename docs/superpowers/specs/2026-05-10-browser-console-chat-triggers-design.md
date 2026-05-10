# Design: Browser Workspace v2 Follow-up — Console + Chat Triggers

## Technical Approach

Extend Browser Workspace v2 with a per-browser console pipeline owned by Electron main, then surface it through preload/IPC to both the BrowserPanel UI and the agent tool surface. Add local chat triggers for `@browser` and `/browser` that open or provision the integrated browser explicitly, and inject a synthetic prompt hint so the active agent knows browser tools — including console tools — are available in this desktop session.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Console storage | Renderer-owned cache vs main-owned per-browser store | Main-owned bounded ring buffer keyed by `browserId` | `webContents` events live in main, avoids raw Electron exposure, and keeps UI/agent reads consistent. |
| `@browser` modeling | Fake agent mention vs plain text only vs local trigger + synthetic hint | Local trigger + synthetic text metadata, not an `AgentPart` | Avoids backend agent resolution problems while still giving the model an explicit browser-tools hint. |
| `/browser` execution | Send to server vs local intercept | Local intercept in app submit/command flow | Matches the requirement that behavior stays local, explicit, and never auto-navigates without a URL. |
| Console UI | Heavy dock/panel redesign vs simple in-panel section switch | Minimal Page/Console section inside `BrowserPanel` | Follows the existing icon-first panel without over-styling or moving layout again. |

## Data Flow

```txt
webContents console/error events
  -> main browser console store (per browserId, bounded)
  -> IPC handlers
     -> preload browser API
        -> BrowserPanel Console section
        -> browser.console_messages / browser.console_clear

@browser or /browser
  -> local app handler
  -> open/activate BrowserPanel + ensure active browser
  -> synthetic prompt hint added to request parts
  -> agent can call browser.* tools, including console tools
```

Main should subscribe per browser instance to `console-message` and map `did-fail-load` (and any stable page-error-style Electron event available on this surface) into synthetic `error` entries. Stored entries are normalized to:

```ts
type BrowserConsoleEntry = {
  browserId: string
  level: "log" | "info" | "warn" | "error" | "debug"
  message: string
  source: string
  line: number | null
  timestamp: number
}
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/desktop/src/main/browser/console-store.ts` | Create | Per-browser ring buffer, normalization, redaction, and bounded reads/clears. |
| `packages/desktop/src/main/browser/MultiBrowserManager.ts` | Modify | Register/unregister console listeners for each browser instance. |
| `packages/desktop/src/main/browser/types.ts` | Modify | Add console entry/filter/tool payload types. |
| `packages/desktop/src/main/browser/ipc-handlers.ts` | Modify | Add `browser-console-messages` and `browser-console-clear` handlers. |
| `packages/desktop/src/preload/types.ts` / `browser.ts` | Modify | Expose renderer methods plus canonical tool aliases `browser.console_messages` and `browser.console_clear`. |
| `packages/app/src/components/browser-panel/BrowserPanel.tsx` / `.css` | Modify | Add Page/Console section, entry list, empty state, and clear action. |
| `packages/app/src/context/browser-types.ts` | Modify | Mirror console entry/filter/result contracts in renderer types. |
| `packages/app/src/context/browser-actions.ts` | Create | Reusable helper to open panel, create a browser if missing, activate it, and optionally navigate. |
| `packages/app/src/components/prompt-input.tsx` | Modify | Add `@browser` picker option and special `/browser` picker behavior. |
| `packages/app/src/components/prompt-input/build-request-parts.ts` | Modify | Inject synthetic browser-availability note when `@browser` or `/browser` is used. |
| `packages/app/src/components/prompt-input/submit.ts` | Modify | Intercept `/browser` locally before server submission. |
| `packages/app/src/pages/session/use-session-commands.tsx` | Modify | Register `/browser` command with BrowserPanel activation behavior. |

## Interfaces / Contracts

```ts
type BrowserConsoleQuery = {
  browserId?: string
  levels?: BrowserConsoleEntry["level"][]
  limit?: number
}

type BrowserConsoleReadResult = {
  browserId: string
  entries: BrowserConsoleEntry[]
  truncated?: true
}
```

- Store the last 200 entries per browser.
- Default read returns the most recent 50; hard max 100.
- Truncate each message before persistence and bound total tool output before returning it to the agent.
- Redact obvious secrets/noise before exposure: data URLs, very long base64-like tokens, and oversized stack/message payloads.
- Renderer gets typed data only; no `webContents`, event objects, or Electron classes cross preload.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Console store bounds, filtering, redaction, clear semantics | `packages/desktop` Bun tests for the new store and manager listeners |
| Integration | IPC/preload routing and browser tool aliases | Extend `ipc-handlers.test.ts` and `preload/browser.test.ts` |
| UI | BrowserPanel Console section, clear button, trigger behavior | Extend browser panel and prompt-input tests in `packages/app` |

## Migration / Rollout

No migration required. This is additive and local to desktop/browser flows.

## Open Questions

- [ ] Confirm the final synthetic error event list beyond `console-message`; default to `did-fail-load` only if no better stable Electron event is available.
