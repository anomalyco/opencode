# Integrated Browser and Element Annotations for OpenCode Desktop

## Goal

Add a Desktop-only integrated browser to OpenCode with Codex/Copilot-style element annotations, screenshot capture, visible chat capsules, and automatic agent tools.

The feature should let users and agents navigate real web pages inside OpenCode Desktop, select real DOM elements like Chrome DevTools inspect mode, attach comments, and send compact visual capsules to chat while preserving structured browser context for the agent.

## Scope

### In scope

- Desktop-only integrated browser panel.
- Browser opens when the user activates it or when the agent requests it.
- Any URL is allowed.
- Persistent browser cookies/session data.
- Manual and tool-based browser data clearing.
- Automatic agent control through explicit browser tools.
- DOM element annotation flow with inline comment bubble.
- Aggregated chat capsule: `1 anotación`, `N anotaciones`.
- Screenshot capture from the integrated browser.
- Hybrid annotation context: compact context sent with the prompt, extended details available on demand.

### Out of scope for the first implementation

- Web/TUI browser support.
- Freeform rectangle annotation as the primary interaction.
- Sharing cookies with Chrome/Edge/system browser profiles.
- Full DevTools replacement.

## Recommended Approach

Use an Electron-native integrated browser with a custom tool layer.

The Desktop app should create and manage a dedicated `WebContentsView` or `BrowserView` from the Electron main process. The renderer remains responsible for OpenCode UI: chat, panels, input, capsules, and user controls. Browser operations flow through IPC and controlled tools rather than exposing the browser internals directly to the renderer or agent.

This approach is preferred over Playwright-first or external-CDP approaches because it gives a native Desktop UX, persistent sessions, better visual integration, and tighter isolation.

## Architecture

```txt
OpenCode Desktop
├─ Renderer principal: chat, input, panels, capsules
├─ Main process Electron
│  ├─ Browser manager
│  ├─ Persistent browser session
│  ├─ IPC browser API
│  └─ Agent browser tools
└─ Browser WebContentsView / BrowserView
   ├─ real navigation
   ├─ persistent cookies
   ├─ element inspect/annotation
   ├─ screenshot capture
   └─ click/type/navigation automation
```

The browser profile must be isolated from both the OpenCode renderer and the user's system browser profile. A dedicated persistent Electron partition such as `persist:opencode-browser` should be used.

## UX Flow

The browser is not always visible. It opens when:

1. the user activates the Browser panel, or
2. the agent calls a browser tool such as `browser.open` or `browser.navigate`.

Annotation flow:

```txt
[Browser closed]
   ↓ user/agent opens
[Browser panel open]
   ↓ user clicks "Anotar"
[Inspect mode]
   ↓ hover DOM elements
[Element highlighted]
   ↓ click
[Inline comment bubble]
   ↓ confirm
[Aggregated annotation capsule in input]
```

The annotation mode should feel like Chrome DevTools element inspect mode:

- hover highlights the actual DOM element;
- click freezes selection;
- a small comment bubble appears over/near the selected element;
- user writes the comment and confirms;
- the chat input shows a compact aggregated capsule.

The capsule intentionally hides technical details from the user. It only communicates that annotations are attached:

- `1 anotación`
- `2 anotaciones`
- `N anotaciones`

## Annotation Data Model

Each annotation should be stored as structured data.

```ts
type BrowserAnnotation = {
  id: string
  pageUrl: string
  pageTitle: string
  userComment: string
  element: {
    tagName: string
    role?: string
    accessibleName?: string
    visibleText?: string
    attributes: Record<string, string>
    selector: string
    xpath?: string
    boundingBox: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  preview: {
    screenshotCrop?: string
    viewportScreenshotId?: string
  }
  context: {
    nearbyDomSanitized?: string
    accessibilitySnapshotNearby?: unknown
  }
  createdAt: number
}
```

Screenshot attachments should be separate but compatible with the same capsule/context pipeline.

```ts
type BrowserScreenshot = {
  id: string
  pageUrl: string
  pageTitle: string
  imageData: string
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
  }
  createdAt: number
}
```

## Agent Context Model

Use a hybrid compact + on-demand model.

### Always sent with the prompt

For each annotation, include compact useful evidence:

- user comment;
- page URL and title;
- selector;
- role/name/text;
- bounding box;
- screenshot crop;
- limited sanitized nearby DOM.

### Available on demand

Keep larger context out of the initial prompt and expose it through tools:

- larger nearby DOM;
- broader accessibility snapshot;
- viewport/full-page screenshot;
- fresh inspect result by selector;
- annotation detail by id.

This avoids polluting the model context and limits prompt-injection risk from arbitrary page DOM.

## Agent Browser Tools

Initial tool surface:

```txt
browser.open()
browser.navigate(url)
browser.back()
browser.forward()
browser.reload()
browser.click(selector | coordinates)
browser.type(selector, text)
browser.press(key)
browser.screenshot()
browser.inspect(selector | coordinates)
browser.get_snapshot()
browser.annotation.get_detail(id)
browser.clear_data()
browser.upload_file(selector, fileRef)
browser.downloads.list()
```

Agent actions are automatic by user decision, but every capability must go through explicit tools. The agent must not get direct access to Electron internals or arbitrary filesystem paths.

## Security and Privacy Requirements

- Use a dedicated persistent browser session partition.
- Do not share cookies with Chrome, Edge, or system browser profiles.
- Keep `nodeIntegration` disabled for external pages.
- Keep `contextIsolation` enabled.
- Avoid dangerous preload scripts in arbitrary web pages.
- Sanitize and bound DOM text before sending it to the agent.
- Do not log cookies, auth headers, tokens, or full page contents.
- Downloads must go to a controlled location.
- Uploads must use workspace files or explicit file references.
- Provide user UI to clear cookies/cache/session.
- Provide tool access to clear browser data.

The user explicitly accepts automatic browser actions and arbitrary URL navigation, so the design focuses on isolation, controlled APIs, and clear data boundaries rather than per-action approval prompts.

## Integration Points

Likely Desktop files/directories:

```txt
packages/desktop/src/main/
packages/desktop/src/preload/
```

New or extended responsibilities:

- `BrowserManager` in main process;
- browser view lifecycle;
- persistent session setup;
- IPC handlers for browser UI and tools;
- permission and download handling;
- screenshot and inspect support.

Likely app/renderer files/directories:

```txt
packages/app/src/components/prompt-input.tsx
packages/app/src/context/prompt.tsx
packages/app/src/components/prompt-input/build-request-parts.ts
```

New UI/state should be extracted instead of adding more logic to `prompt-input.tsx`, which is already large and complex.

Suggested new areas:

```txt
packages/app/src/components/browser-panel/
packages/app/src/components/annotation-capsule/
packages/app/src/context/annotation-store.tsx
packages/desktop/src/main/browser/
```

## Implementation Phases

### Phase 1 — Integrated browser basics

- Create browser panel lifecycle.
- Open/close browser view.
- Navigate URL.
- Back/forward/reload.
- Persist cookies/session.
- Clear browser data manually.

### Phase 2 — Agent browser tools

- Add tool bridge for navigation and interaction.
- Implement click/type/press/screenshot/inspect/snapshot/clear-data.
- Ensure all tool calls route through controlled IPC/main-process APIs.

### Phase 3 — DOM element annotation

- Add inspect mode.
- Highlight hovered DOM elements.
- Select element on click.
- Show inline comment bubble.
- Extract selector, role/name/text, bounding box, sanitized nearby DOM, and screenshot crop.

### Phase 4 — Chat capsules and hybrid context

- Add annotation store.
- Show aggregated `N anotaciones` capsule in prompt input.
- Serialize compact annotation context into request parts.
- Store extended annotation context for `annotation.get_detail`.

### Phase 5 — Files, downloads, and hardening

- Controlled uploads with file refs.
- Controlled downloads list/location.
- Permission handling.
- Logging redaction.
- Context size limits and sanitization tests.

## Risks

- Electron view embedding may require careful resizing/layout synchronization with the renderer panel.
- External pages are untrusted and may contain prompt-injection content in DOM text.
- Persistent cookies improve UX but increase privacy/security responsibility.
- `prompt-input.tsx` is already complex; feature logic must be kept outside it where possible.
- Automatic browser tools can interact with real accounts and forms; isolation and auditability matter.

## Open Decisions

- Exact Electron primitive: `WebContentsView` versus `BrowserView`, based on the Electron version and existing app window architecture.
- Whether screenshot attachments share the existing image attachment UI or get their own browser capsule type.
- Exact storage location and retention behavior for extended annotation details and screenshots.
