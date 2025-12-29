# Tasks: Enable Threaded Rendering

## 1. Implementation
- [x] 1.1 Add `useThread: true` to render config in `app.tsx`

## 2. Verification
- [x] 2.1 Run typecheck to ensure no type errors
- [x] 2.2 Test TUI with normal typing - confirm no freezing
- [x] 2.3 Verify with perf diagnostics (OPENCODE_PERF_DEBUG=1) - confirm zero blocked events

## 3. Cleanup
- [x] 3.1 Remove diagnostic instrumentation code
- [x] 3.2 Commit and push changes
