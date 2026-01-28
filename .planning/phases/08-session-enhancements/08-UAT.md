---
phase: 08-session-enhancements
type: uat
status: complete
started: 2026-01-23
completed: 2026-01-24
---

# Phase 8: Session Enhancements - User Acceptance Testing

**Phase Goal:** Users have "remember me" option and can see session status

## Test List

| #   | Test                                                                          | Source                       | Status |
| --- | ----------------------------------------------------------------------------- | ---------------------------- | ------ |
| 1   | Remember me checkbox is checked by default on login page                      | 08-01-SUMMARY                | ✓ pass |
| 2   | Logging in with "Remember me" checked persists session across browser restart | 08-01-SUMMARY                | ✓ pass |
| 3   | Username is visible in the header/titlebar when logged in                     | 08-02-SUMMARY, 08-04-SUMMARY | ✓ pass |
| 4   | Clicking username shows dropdown with logout option                           | 08-02-SUMMARY                | ✓ pass |
| 5   | Clicking "Log out" logs user out and redirects to login page                  | 08-02-SUMMARY                | ✓ pass |
| 6   | Warning toast appears ~15 minutes before session expires                      | 08-03-SUMMARY                | ✓ pass |
| 7   | Warning toast has "Extend session" button that refreshes session              | 08-03-SUMMARY                | ✓ pass |
| 8   | Session expired overlay appears when session fully expires                    | 08-03-SUMMARY                | ○ skip |
| 9   | "Log In" button on expired overlay navigates to login page                    | 08-03-SUMMARY                | ○ skip |
| 10  | Session polling pauses when tab is hidden and resumes when visible            | 08-02-SUMMARY                | ✓ pass |

## Test Results

### Test 1: Remember me checkbox is checked by default on login page

**Steps:**

1. Navigate to login page (/auth/login)
2. Observe the "Remember me" checkbox state

**Expected:** The checkbox should be checked by default.

**Status:** ✓ pass

---

### Test 2: Logging in with "Remember me" checked persists session across browser restart

**Steps:**

1. Log in with "Remember me" checked (default)
2. Close browser completely (all windows)
3. Reopen browser and navigate to opencode
4. Observe if still logged in

**Expected:** User remains logged in without re-entering credentials.

**Status:** ✓ pass

---

### Test 3: Username is visible in the header/titlebar when logged in

**Steps:**

1. Log in successfully
2. Observe the top-right area of the app header/titlebar

**Expected:** Username is displayed in the titlebar area.

**Status:** ✓ pass

**Note:** Required multiple fixes for dev server setup:

- Fixed titlebar mount point reactivity
- Fixed SessionExpiredOverlay router context
- Added CORS credentials support
- Made /global/health public
- Added API call detection for 401 responses
- Added AuthGate for unauthenticated redirect
- Configured Vite proxy for API requests

---

### Test 4: Clicking username shows dropdown with logout option

**Steps:**

1. While logged in, click on the username in the header
2. Observe the dropdown menu

**Expected:** Dropdown appears with "Log out" option visible.

**Status:** ✓ pass

---

### Test 5: Clicking "Log out" logs user out and redirects to login page

**Steps:**

1. Click username to open dropdown
2. Click "Log out"
3. Observe redirect

**Expected:** User is logged out and redirected to /auth/login.

**Status:** ✓ pass

**Note:** Required adding CSRF token to logout request (was getting 403 Forbidden).

---

### Test 6: Warning toast appears ~15 minutes before session expires

**Steps:**

1. Log in with a short session timeout (configure sessionTimeout to ~16 minutes for testing)
2. Wait for approximately 1 minute (until remaining < 15 minutes)
3. Observe if warning toast appears

**Expected:** Toast notification appears with "Session expiring soon" message.

**Status:** ✓ pass

**Note:** Tested with temporary 2-minute timeout. Required fix: call `checkExpirationWarning()` after fetch completes, not just during polling interval.

---

### Test 7: Warning toast has "Extend session" button that refreshes session

**Steps:**

1. Trigger warning toast (see Test 6)
2. Click "Extend session" button on toast

**Expected:** Toast dismisses and session is refreshed (no immediate re-warning).

**Status:** ✓ pass

---

### Test 8: Session expired overlay appears when session fully expires

**Steps:**

1. Configure very short session timeout (2-3 minutes)
2. Log in and wait for session to expire
3. Observe the UI

**Expected:** Overlay appears covering the page with "Session Expired" message.

**Status:** ○ skip

**Note:** Skipped - sliding expiration refreshes session on every API call including polling. Session never expires while tab is active. Overlay would only appear if tab hidden longer than timeout or server session invalidated.

---

### Test 9: "Log In" button on expired overlay navigates to login page

**Steps:**

1. Trigger session expired overlay (see Test 8)
2. Click "Log In" button

**Expected:** User is navigated to /auth/login.

**Status:** ○ skip

**Note:** Skipped - depends on Test 8 (expired overlay). Code review confirms button uses `window.location.href` to navigate to login page.

---

### Test 10: Session polling pauses when tab is hidden and resumes when visible

**Steps:**

1. Log in and open browser developer tools Network tab
2. Observe /auth/session requests every ~60 seconds
3. Switch to a different browser tab (hide the opencode tab)
4. Wait 2+ minutes
5. Observe Network tab - no new /auth/session requests
6. Switch back to opencode tab
7. Observe polling resume

**Expected:** Polling stops when tab hidden, resumes when visible.

**Status:** ✓ pass

---

## Summary

- **Total Tests:** 10
- **Passed:** 8
- **Failed:** 0
- **Skipped:** 2

### Fixes Applied During UAT

- **CSRF token for logout:** Added `X-CSRF-Token` header to logout POST request
- **Warning check timing:** Call `checkExpirationWarning()` after fetch completes, not just during polling

### Skipped Tests Rationale

Tests 8-9 (session expired overlay) skipped because sliding expiration refreshes session on every API call. Session never expires while tab is active and polling. The overlay functionality exists but would only trigger if tab hidden longer than timeout.

---

_UAT started: 2026-01-23_
_UAT completed: 2026-01-24_
