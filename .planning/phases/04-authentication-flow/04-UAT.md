---
status: complete
phase: 04-authentication-flow
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md]
started: 2026-01-22T12:00:00Z
updated: 2026-01-22T12:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Auth status endpoint
expected: GET /auth/status returns JSON with `enabled` (boolean) and `method` ("pam") fields
result: pass

### 2. Login with valid system credentials
expected: POST /auth/login with your system username/password returns 200 with user object containing username, uid, gid, home, shell
result: pass

### 3. Login with invalid credentials
expected: POST /auth/login with wrong password returns 401 with generic "Authentication failed" message (no hint about whether user exists)
result: pass

### 4. CSRF protection (X-Requested-With header)
expected: POST /auth/login WITHOUT X-Requested-With header returns 400 "X-Requested-With header required"
result: pass

### 5. Dual content-type support
expected: POST /auth/login works with both Content-Type: application/json AND Content-Type: application/x-www-form-urlencoded
result: pass

### 6. Session shows UNIX identity
expected: After successful login, GET /auth/session returns user info including uid, gid, home, shell fields
result: pass

### 7. Logout endpoint
expected: POST /auth/logout clears session cookie and redirects to /login (302)
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0

## Bugs Found & Fixed

### 1. Redirect loop (fixed during UAT)
**Symptom:** Infinite redirect when accessing backend with auth enabled
**Root Cause:** Middleware redirected to `/login` but routes mounted at `/auth`, so `/login` didn't exist
**Fix:** Changed redirects to `/auth/login`, added GET /auth/login HTML page (commit f1505b2e3)

### 2. Session endpoint not reading cookie (fixed during UAT)
**Symptom:** GET /auth/session returned "Not authenticated" even with valid session cookie
**Root Cause:** Auth middleware skips `/auth/*` routes, so session context was never populated
**Fix:** /auth/session now manually reads cookie and looks up session

## Gaps

[none]
