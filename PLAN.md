# Phone-Friendly Remote Control UX Implementation Plan

## Context & Pain Points

When a user is running OpenCode on their desktop but monitoring it from their phone, the current UX for handling input prompts (questions, permissions) has several friction points:

1. **Visibility**: The user might not realize the session is blocked waiting for input if they are looking at the "changes" tab or if the prompt is scrolled out of view.
2. **Touch Targets**: While some buttons use `size="large"`, the custom input textareas and option checkboxes can be hard to tap accurately on mobile.
3. **Keyboard Obscuration**: When typing a custom answer on mobile, the virtual keyboard often obscures the prompt context or the submit button.
4. **Context Switching**: Switching between the "session" tab (to answer) and "changes" tab (to review what the agent did before asking) is cumbersome.

## Proposed First Slice (Minimal & Incremental)

Focus on **Visibility** and **Touch Ergonomics** for the existing `DockPrompt` components (`SessionQuestionDock` and `SessionPermissionDock`).

### 1. Sticky/Prominent "Blocked" Indicator

When the session is blocked waiting for input, ensure this state is immediately obvious regardless of scroll position or active tab.

- **Implementation**: Add a sticky banner or floating action button (FAB) at the bottom of the screen (above the composer) on mobile when a prompt is active. Tapping it scrolls to the prompt or switches to the "session" tab if needed.
- **Touched Files**:
  - `packages/app/src/pages/session.tsx` (to add the global indicator based on `composer.blocked()`)
  - `packages/app/src/pages/session/composer/session-composer-region.tsx` (to position it relative to the composer)

### 2. Improved Touch Targets for Options

Make the entire option row in `SessionQuestionDock` a larger, more forgiving touch target.

- **Implementation**: Increase padding on `[data-slot="question-option"]` in mobile views. Ensure the custom input textarea expands properly and doesn't require precise tapping to focus.
- **Touched Files**:
  - `packages/ui/src/components/message-part.css` (where `[data-slot="question-option"]` is styled)
  - `packages/app/src/pages/session/composer/session-question-dock.tsx`

### 3. Auto-Scroll to Prompt on Mobile

When a new prompt appears, automatically scroll it into view, especially on mobile where screen real estate is limited.

- **Implementation**: Enhance the `measure` or `onMount` logic in `SessionQuestionDock` and `SessionPermissionDock` to trigger a scroll-into-view if the component is rendered and the viewport is mobile-sized.
- **Touched Files**:
  - `packages/app/src/pages/session/composer/session-question-dock.tsx`
  - `packages/app/src/pages/session/composer/session-permission-dock.tsx`

## Test Approach

1.  **Unit/Component Tests**:
    - Verify the "Blocked" indicator renders when `composer.blocked()` is true.
    - Verify click handlers on the indicator correctly update the active tab and scroll position.
2.  **E2E Tests (Playwright)**:
    - Create a test simulating a mobile viewport (`isMobile: true` in Playwright config).
    - Trigger a permission prompt.
    - Verify the sticky indicator appears.
    - Click the indicator and verify the prompt is visible.
    - Interact with the larger touch targets.

## Browser-Validation Steps (Manual)

1.  Start the backend (`bun run --conditions=browser ./src/index.ts serve --port 4096`) and frontend (`bun dev -- --port 4444`).
2.  Open `http://localhost:4444` in a desktop browser.
3.  Use Chrome DevTools Device Toolbar (F12 -> Ctrl+Shift+M) to simulate a mobile device (e.g., iPhone 14 Pro).
4.  Start a session and trigger a command that requires permission (e.g., `bash ls`).
5.  **Verify**:
    - The new sticky "Blocked" indicator appears.
    - Tapping it scrolls the permission dock into view.
    - The "Allow" / "Deny" buttons are easily tappable.
6.  Trigger a question prompt (e.g., using a test script or specific agent interaction).
7.  **Verify**:
    - The options have adequate padding for touch.
    - Selecting a custom input option focuses the textarea without the virtual keyboard hiding the context (simulate keyboard by resizing viewport height).
