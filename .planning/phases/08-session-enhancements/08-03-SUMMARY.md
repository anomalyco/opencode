---
phase: 08
plan: 03
title: "Session Expiration Warnings and Overlay"
subsystem: "auth"
tags: ["session", "ui", "toast", "overlay", "expiration"]
dependency-graph:
  requires:
    - "08-02: Session context with polling and expiration tracking"
  provides:
    - "Warning toast 15 min before session expiration"
    - "Session expired overlay component"
  affects:
    - "Future: Could enhance with countdown timer in toast"
tech-stack:
  added: []
  patterns:
    - "Toast notifications for session warnings"
    - "Modal overlay for expired state"
    - "Polling-based expiration checks"
key-files:
  created:
    - "packages/app/src/components/session-expired-overlay.tsx"
  modified:
    - "packages/app/src/context/session.tsx"
    - "packages/app/src/app.tsx"
decisions:
  - name: "No icon for expiration toast"
    rationale: "Icon set doesn't include clock/time icons; persistent toast with title is sufficient"
  - name: "Inline styles for overlay"
    rationale: "Simple one-off component with specific z-index requirements; easier to maintain inline"
  - name: "Warning shown once per expiration window"
    rationale: "Prevents toast spam; user can extend or dismiss once"
metrics:
  duration: "3.5 min"
  completed: "2026-01-23"
---

# Phase 08 Plan 03: Session Expiration Warnings and Overlay Summary

**One-liner:** Warning toast 15 min before expiry with extend button; modal overlay when session expires

## What Was Built

Implemented session expiration warnings and expired session handling:

1. **Expiration warning toast** - Appears 15 minutes before session expires with persistent toast notification
2. **Extend session button** - User can click to refresh session without leaving page
3. **Session expired overlay** - Modal covering page when session expires, prompting re-login
4. **Warning state management** - Toast shown once per expiration window; resets when session extended

## Technical Implementation

### Session Context Enhancements

**Added warning threshold:**

```typescript
const WARNING_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes
```

**Warning state tracking:**

- `warningShown` flag prevents duplicate toasts
- `warningToastId` allows dismissal when session extended
- Check runs during polling interval

**Warning logic:**

```typescript
function checkExpirationWarning() {
  const remaining = remainingMs()

  // Show warning when below threshold
  if (remaining < WARNING_THRESHOLD_MS && remaining > 0 && !warningShown) {
    warningShown = true
    warningToastId = showToast({
      title: "Session expiring soon",
      description: "Your session will expire in about 15 minutes",
      persistent: true,
      actions: [
        {
          label: "Extend session",
          onClick: async () => {
            await fetch(`${url}/auth/session`, { credentials: "include" })
            // Reset warning state
            warningShown = false
            toaster.dismiss(warningToastId)
          },
        },
      ],
    })
  }

  // Reset when session extended
  if (remaining >= WARNING_THRESHOLD_MS && warningShown) {
    warningShown = false
    toaster.dismiss(warningToastId)
  }
}
```

**Extend session mechanism:**

- Fetches `/auth/session` endpoint
- Triggers `UserSession.touch()` via middleware
- Updates `lastAccessTime`
- Polling picks up new expiration time

### Session Expired Overlay

**Created `SessionExpiredOverlay` component:**

- Uses `@kobalte/core/dialog` for modal behavior
- Opens when `isExpired()` signal is true
- Semi-transparent backdrop (rgba(0,0,0,0.8))
- Dark themed card (bg-neutral-900)
- "Log In" button navigates to `/auth/login`
- User's work visible behind overlay

**Mounted at app level:**

```tsx
<SessionProvider>
  <SessionExpiredOverlay />
  <GlobalSDKProvider>...</GlobalSDKProvider>
</SessionProvider>
```

Positioned inside `SessionProvider` to access session context, but before other providers to ensure global coverage.

## Files Changed

### Created

**`packages/app/src/components/session-expired-overlay.tsx`**

- Modal overlay component
- Dialog from @kobalte/core
- Dark theme styling
- Navigation to login page

### Modified

**`packages/app/src/context/session.tsx`**

- Added toast imports
- Warning threshold constant
- Warning state tracking
- `checkExpirationWarning()` function
- Warning check in polling loop

**`packages/app/src/app.tsx`**

- Import `SessionExpiredOverlay`
- Mount component in app tree

## Decisions Made

### 1. No Icon for Expiration Toast

**Decision:** Don't use icon in warning toast
**Rationale:** Icon set doesn't include clock/time icons; persistent toast with clear title/description is sufficient
**Alternatives considered:** Adding custom clock icon (unnecessary complexity)

### 2. Inline Styles for Overlay

**Decision:** Use inline styles for overlay component
**Rationale:** Simple one-off component with specific z-index requirements; easier to maintain inline than separate CSS
**Alternatives considered:** Tailwind classes (would need arbitrary values for z-index)

### 3. Warning Shown Once Per Window

**Decision:** Track warning state to show toast only once
**Rationale:** Prevents toast spam; user can extend or dismiss once they've seen it
**Implementation:** Reset `warningShown` flag when session extended

### 4. Persistent Toast

**Decision:** Make warning toast persistent (no auto-dismiss)
**Rationale:** Critical information requiring user action; shouldn't disappear automatically
**User control:** User can still dismiss via close button or by extending session

## Next Phase Readiness

**Enables:**

- 08-04: Session indicator can show username/status alongside expiration warnings

**Benefits:**

- Users warned before session expires
- Seamless session extension without leaving page
- Clear expired state handling with re-login prompt
- Work remains visible during expiration overlay

**User Experience:**

- Proactive warning gives users time to save work
- One-click session extension
- Clear call-to-action when session expires
- No silent failures or unexpected logouts

## Open Questions

None.

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

**Manual verification needed:**

1. Simulate short session timeout (set to < 15 min)
2. Verify warning toast appears at 15 min mark
3. Click "Extend session" - toast dismisses, session continues
4. Let session fully expire - overlay appears
5. Verify "Log In" button navigates to /auth/login
6. Verify user's work visible behind overlay

**Integration points:**

- Toast.Region already mounted in `layout.tsx`
- `/auth/session` endpoint exists and triggers touch
- `isExpired` signal already implemented in session context
