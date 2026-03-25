# Weave Fork Phase Gates

This checklist operationalizes the execution gates for the OpenCode fork in this repository.

## Gate A - Fork Setup

- [x] `origin` points to `antkim003/opencode`
- [x] `upstream` points to `anomalyco/opencode`
- [x] default working branch is `dev`
- [x] fork sync workflow is documented in team workflow notes

## Gate B - Architecture Decision Sign-off

- [ ] `OPENCODE_ARCHITECTURE_DECISIONS.md` has a named owner
- [ ] sign-off approver and date are recorded
- [ ] storage/message/tool-id choices are marked final (not provisional)

## Gate C - Weave Seam Activation

- [ ] `packages/opencode/src/session/weave/` namespace exists
- [ ] prompt assembly routes through Weave context builder seam
- [ ] no baseline command regressions in startup, chat, and tool execution

## Gate D - Core Weave Runtime

- [ ] dual-store persistence migrations run successfully
- [ ] context, threads, episodes, and compaction primitives persist to Weave store
- [ ] retrieval tools operate on Weave-owned records

## Gate E - Parity and OAuth

- [ ] CLI/TUI parity matrix passes
- [ ] OAuth conformance matrix passes for streaming and non-streaming

## Gate F - Cutover Readiness

- [ ] cutover scorecard compares `weave_ex` and `weave_opencode`
- [ ] go/no-go criteria documented
- [ ] rollback procedure documented and tested
