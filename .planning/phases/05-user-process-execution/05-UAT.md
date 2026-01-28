---
status: complete
phase: 05-user-process-execution
source:
  [
    05-01-SUMMARY.md,
    05-02-SUMMARY.md,
    05-03-SUMMARY.md,
    05-04-SUMMARY.md,
    05-05-SUMMARY.md,
    05-06-SUMMARY.md,
    05-07-SUMMARY.md,
    05-08-SUMMARY.md,
    05-09-SUMMARY.md,
    05-10-SUMMARY.md,
  ]
started: 2026-01-22T18:30:00Z
updated: 2026-01-22T18:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Broker responds to ping

expected: Start the broker as root, run test-pty-spawn.ts. Broker shows "Broker is running" message.
result: pass

### 2. Session registration succeeds

expected: test-pty-spawn.ts shows "Session registered: manual-test-{timestamp}" without errors.
result: pass

### 3. PTY spawns with ptyId and pid

expected: test-pty-spawn.ts shows "PTY spawned: {uuid} (pid={number})" indicating successful spawn.
result: pass

### 4. PTY write succeeds

expected: test-pty-spawn.ts shows "Command sent" after writing 'id' command to PTY.
result: pass

### 5. PTY read returns shell output

expected: test-pty-spawn.ts shows "Output:" section with shell prompt or command output. May show uid= in output.
result: pass

### 6. Spawned process runs as correct user

expected: If the shell has time to execute `id`, output contains `uid={your-uid}` matching your system user.
result: pass

### 7. PTY cleanup succeeds

expected: test-pty-spawn.ts shows "PTY killed: true" and "Session unregistered: true" in cleanup section.
result: pass

### 8. Integration tests pass

expected: Run `cd packages/opencode && bun test test/integration/user-process.test.ts`. All 9 tests pass (or skip gracefully if broker config differs).
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
