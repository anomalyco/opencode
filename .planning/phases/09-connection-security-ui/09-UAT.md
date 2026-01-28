---
phase: 09-connection-security-ui
uat_started: 2026-01-24
uat_completed: 2026-01-24
status: complete
---

# Phase 9: Connection Security UI - User Acceptance Testing

## Test List

| #   | Test                                      | Status                       |
| --- | ----------------------------------------- | ---------------------------- |
| 1   | SecurityBadge visible in titlebar         | ✅ pass                      |
| 2   | Localhost shows blue home icon            | ✅ pass (icon gray)          |
| 3   | Click badge shows security popover        | ✅ pass                      |
| 4   | HTTPS shows green lock icon               | ⏭️ skip (test when deployed) |
| 5   | HTTP non-localhost shows red warning icon | ⏭️ skip (test when deployed) |
| 6   | HTTP warning banner appears               | ⏭️ skip (test deferred)      |
| 7   | Banner dismissal works                    | ⏭️ skip (deferred)           |
| 8   | Banner dismissal persists after refresh   | ⏭️ skip (deferred)           |

## Test Details

### Test 1: SecurityBadge visible in titlebar

**Setup:** Access opencode at http://localhost (or your dev server)
**Steps:**

1. Look at the titlebar area (top of the window)
2. Find the security badge near the session indicator (username)

**Expected:** A security badge icon is visible in the titlebar without needing to click anything

---

### Test 2: Localhost shows blue home icon

**Setup:** Access opencode at http://localhost or http://127.0.0.1
**Steps:**

1. Look at the security badge in the titlebar

**Expected:** Blue home icon displayed (not red warning, not green lock)

---

### Test 3: Click badge shows security popover

**Setup:** Access opencode at localhost
**Steps:**

1. Click on the security badge icon
2. Read the popover content

**Expected:** Popover opens showing "Local Connection" title with explanation that localhost connections don't require HTTPS

---

### Test 4: HTTPS shows green lock icon

**Setup:** Access opencode over HTTPS (may require reverse proxy or ngrok)
**Steps:**

1. Look at the security badge in the titlebar

**Expected:** Green lock icon displayed

---

### Test 5: HTTP non-localhost shows red warning icon

**Setup:** Access opencode over HTTP from a non-localhost address (e.g., ngrok tunnel, remote IP, or hostname other than localhost/127.0.0.1)
**Steps:**

1. Look at the security badge in the titlebar

**Expected:** Red lock-open (warning) icon displayed

---

### Test 6: HTTP warning banner appears

**Setup:** Clear localStorage (`localStorage.removeItem('opencode:security-warning-dismissed')`) and access opencode over HTTP from non-localhost
**Steps:**

1. Open browser devtools console
2. Run: `localStorage.removeItem('opencode:security-warning-dismissed')`
3. Refresh the page
4. Look below the titlebar

**Expected:** Amber/yellow warning banner appears with security warning message

---

### Test 7: Banner dismissal works

**Setup:** Have the HTTP warning banner visible (from Test 6)
**Steps:**

1. Find the dismiss button (X) on the warning banner
2. Click to dismiss

**Expected:** Banner disappears immediately

---

### Test 8: Banner dismissal persists after refresh

**Setup:** Have dismissed the banner (from Test 7)
**Steps:**

1. Refresh the page
2. Look below the titlebar

**Expected:** Banner does NOT reappear (dismissal was saved to localStorage)

---

## Results

**Completed:** 2026-01-24

| Outcome    | Count |
| ---------- | ----- |
| ✅ Passed  | 3     |
| ❌ Failed  | 0     |
| ⏭️ Skipped | 5     |

**Summary:** Core localhost functionality verified (badge visible, home icon displayed, popover works). Tests requiring HTTPS or non-localhost HTTP access deferred until deployed to a server.

**Notes:**

- Test 2: Icon is gray instead of blue (acceptable)
- Tests 4-8: Deferred - require HTTPS or non-localhost HTTP access for proper testing
