---
status: complete
phase: 07-security-hardening
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md]
started: 2026-01-22T20:30:00Z
completed: 2026-01-22T21:00:00Z
---

## Current Test

[UAT Complete]

## Tests

### 1. CSRF Cookie Set After Login
expected: After successful login, browser has "opencode_csrf" cookie alongside session cookie
result: pass

### 2. CSRF Token Required for POST Requests
expected: Making a POST request to a protected endpoint without X-CSRF-Token header returns 403 error with "csrf_required" or "csrf_invalid"
result: pass

### 3. CSRF Cookie Cleared on Logout
expected: After clicking logout, the "opencode_csrf" cookie is removed along with the session cookie
result: pass

### 4. Rate Limiting - Blocks After 5 Failed Logins
expected: After 5 failed login attempts from same IP, 6th attempt returns 429 "Too many login attempts" with Retry-After header
result: pass

### 5. Rate Limiting - 429 Includes Retry-After Header
expected: When rate limit is exceeded, response headers include "Retry-After" indicating when to retry
result: pass

### 6. HTTP Warning Banner on Non-Localhost
expected: Accessing login page over HTTP on non-localhost (e.g., via IP address from another device) shows yellow warning banner about insecure connection
result: pass

### 7. HTTP Warning Dismissible
expected: Clicking "I understand the risks" button on HTTP warning banner hides the warning, and it stays hidden on refresh during same browser session
result: skipped

### 8. HTTPS Block Mode Disables Form
expected: With requireHttps="block" config, login page over HTTP shows disabled form with "HTTPS is required" message and no submit button
result: skipped

### 9. Localhost Always Allowed
expected: Login page on localhost (http://localhost:4096) works normally without HTTP warnings even when requireHttps is "warn" or "block"
result: pass

### 10. Security Events Logged
expected: Failed login attempts are logged with masked username (e.g., "pe***r") in server logs
result: pass

## Summary

total: 10
passed: 8
issues: 0
pending: 0
skipped: 2

## Gaps

[none yet]
