# Tasks: remove compat dual-write leftovers from change state store

## Slice A — Comment/doc cleanup (no behavioral change)

- [ ] 1. Remove `NewWithCompat` reference from `current.go` comment
  - Files: `internal/infra/changestate/current.go`
  - Validation: `grep -c "NewWithCompat" internal/infra/changestate/current.go` → 0

- [ ] 2. Remove `NewWithCompat` reference from `maintenance_test.go` comment
  - Files: `internal/supervisor/maintenance_test.go`
  - Validation: `grep -c "NewWithCompat" internal/supervisor/maintenance_test.go` → 0

- [ ] 3. Remove stale compat references from archived coder-context.md
  - Files: `openspec/archive/change-state-store/.skein/coder-context.md`
  - Validation: `grep -c "NewWithCompat" openspec/archive/change-state-store/.skein/coder-context.md` → 0

- [ ] 4. Remove stale compat references from design doc
  - Files: `openspec/changes/supervisor-outcome-robustness-antiloop/design.md`
  - Validation: `grep -c "NewWithCompat" openspec/changes/supervisor-outcome-robustness-antiloop/design.md` → 0

## Slice B — Remove dead `legacySetBlocked()` path

- [ ] 5. Remove `legacySetBlocked()` function from `blocked_reason.go`
  - Files: `internal/supervisor/blocked_reason.go`
  - Validation: `grep -c "legacySetBlocked" internal/supervisor/blocked_reason.go` → 0

- [ ] 6. Remove legacy fallback call in `progress_gate.go` and simplify `setBlocked` closure
  - Files: `internal/supervisor/progress_gate.go`
  - Validation: `grep -c "legacySetBlocked" internal/supervisor/progress_gate.go` → 0

- [ ] 7. Remove TODO comment about resolveStatus migration in `blocked_reason.go`
  - Files: `internal/supervisor/blocked_reason.go`
  - Validation: `grep -c "TODO(change-state-store)" internal/supervisor/blocked_reason.go` → 0

## Slice C — Migrate `agent.go` to store.ReadRunResult, remove legacy helper

- [ ] 8. Thread store through `agent.go` and replace `ReadRunResult(changeSkeinDir)` with `store.ReadRunResult(slug)`
  - Files: `internal/supervisor/agent.go`
  - Validation: `grep "store.ReadRunResult" internal/supervisor/agent.go` returns 1 match

- [ ] 9. Remove legacy `ReadRunResult()` and `runResultSkeinDir()` from `run_result.go`
  - Files: `internal/supervisor/run_result.go`
  - Validation: `grep -c "func ReadRunResult\|func runResultSkeinDir" internal/supervisor/run_result.go` → 0

- [ ] 10. Update `run_result_test.go` to use store-based read
  - Files: `internal/supervisor/run_result_test.go`
  - Validation: `go test ./internal/supervisor/ -run TestReadRunResult -count=1` passes

## Slice D — Remove nil-fallback from `markStuck()`, fix callers

- [ ] 11. Simplify `markStuck()` to require non-nil store, remove `legacyWriteStuckReason` path
  - Files: `internal/supervisor/stuck_reason.go`
  - Validation: `grep -c "legacyWriteStuckReason" internal/supervisor/stuck_reason.go` → 0

- [ ] 12. Fix `change_queue_adapter.go` caller to pass store instead of nil
  - Files: `internal/supervisor/change_queue_adapter.go`
  - Validation: `grep -c 'markStuck.*nil' internal/supervisor/change_queue_adapter.go` → 0

- [ ] 13. Fix `verification_backlog.go` callers to pass store instead of nil
  - Files: `internal/supervisor/verification_backlog.go`
  - Validation: `grep -c 'markStuck.*nil' internal/supervisor/verification_backlog.go` → 0

- [ ] 14. Fix `pipeline_coder.go` caller to pass store instead of nil
  - Files: `internal/supervisor/pipeline_coder.go`
  - Validation: `grep -c 'markStuck.*nil' internal/supervisor/pipeline_coder.go` → 0

- [ ] 15. Fix `pipeline_stages.go` caller to pass store instead of nil
  - Files: `internal/supervisor/pipeline_stages.go`
  - Validation: `grep -c 'markStuck.*nil' internal/supervisor/pipeline_stages.go` → 0

- [ ] 16. Remove `writeStuckReason()` wrapper from `stuck_reason.go`
  - Files: `internal/supervisor/stuck_reason.go`
  - Validation: `grep -c "func writeStuckReason" internal/supervisor/stuck_reason.go` → 0

- [ ] 17. Fix `stuck_reason_test.go` to pass store instead of nil
  - Files: `internal/supervisor/stuck_reason_test.go`
  - Validation: `go test ./internal/supervisor/ -run TestMarkStuck -count=1` passes

## Slice E — Clean up nil-fallbacks in `openspec/flags.go`

- [ ] 18. Remove legacy path fallback from `skeinDir()`, `ResetFlags()`, `TouchVerified()`, `TouchStuck()`
  - Files: `internal/openspec/flags.go`
  - Validation: `go build ./internal/openspec/` compiles without errors

- [ ] 19. Remove legacy priority fallback from `resolvePriority()` in `load.go`
  - Files: `internal/openspec/load.go`
  - Validation: `grep -c "Legacy fallback" internal/openspec/load.go` → 0

## Slice F — Test and verify

- [ ] 20. Update `progress_gate_test.go` to remove `legacySetBlocked` test
  - Files: `internal/supervisor/progress_gate_test.go`
  - Validation: `go test ./internal/supervisor/ -run TestProgressGate -count=1` passes

- [ ] 21. Update `migrate_test.go` variable names to remove `specBase` → `specDir` (cosmetic)
  - Files: `internal/infra/changestate/migrate_test.go`
  - Validation: `go test ./internal/infra/changestate/ -run TestMigrate -count=1` passes

- [ ] 22. Run full test suite for all affected packages
  - Files: N/A (validation step)
  - Validation: `go test ./internal/supervisor/ ./internal/openspec/ ./internal/infra/changestate/ ./internal/auditor/ -count=1` all pass

## Slice G — Final cleanup

- [ ] 23. Remove stale `NewWithCompat` references from `migrate.go` comments (cosmetic)
  - Files: `internal/infra/changestate/migrate.go`
  - Validation: `grep -c "dual.write\|dual-write" internal/infra/changestate/migrate.go` → 0 (or comment updated)

- [ ] 24. Final sweep for any remaining compat/dual-write references
  - Files: `internal/` (sweep)
  - Validation: `grep -rn "NewWithCompat\|dual.write\|dual-write" internal/` returns 0 results
