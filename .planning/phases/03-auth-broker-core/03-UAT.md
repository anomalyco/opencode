---
status: complete
phase: 03-auth-broker-core
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md]
started: 2026-01-20T21:00:00Z
updated: 2026-01-20T21:01:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Broker binary builds
expected: Run `cd packages/opencode-broker && cargo build --release`. Build completes without errors.
result: pass

### 2. Broker starts and creates socket
expected: Run `sudo ./packages/opencode-broker/target/release/opencode-broker`. Log shows "opencode-broker starting" and socket is created at /var/run/opencode/auth.sock (macOS) or /run/opencode/auth.sock (Linux).
result: pass

### 3. Broker status shows health
expected: With broker running, run `bun run dev auth broker status`. Shows "Broker responding: yes", "PAM config: installed", "Broker binary: installed".
result: pass

### 4. Setup installs PAM config
expected: Run `sudo bun run dev auth broker setup`. PAM config installed to /etc/pam.d/opencode. Verify with `cat /etc/pam.d/opencode`.
result: pass

### 5. PAM authentication with real credentials
expected: With broker running, authenticate using your actual system username/password. Broker returns success response. (Requires manual test via client or direct socket.)
result: pass

### 6. Graceful shutdown on SIGTERM
expected: Send SIGTERM to running broker (`kill -TERM <pid>`). Broker logs shutdown message and exits cleanly without crash.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
