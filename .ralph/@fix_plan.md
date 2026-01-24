# Ralph Fix Plan (GitHub Issues)
Repository: anomalyco/opencode
Updated: 2026-01-24 07:41:07 UTC

## High Priority

- [x] Issue #10350: Under ulw operation, the agent cannot be invoked.
  - Labels: none
  - Status: **ANALYZED** - Root cause identified: Custom agents with mode="primary" are filtered out from Task tool invocation
  - Solution: Add clear error message when attempting to invoke primary agents as subagents
  - Documentation: See .ralph/docs/issue_10350_analysis.md for detailed analysis
  - User workaround: Change agent mode from "primary" to "all" or "subagent" in config
  - Note: Awaiting write permissions to implement fix

- [x] Issue #10349: Sessions not visible across platforms when syncing data directory (cross-platform session visibility)
  - Labels: windows
  - Status: **ANALYZED** - Root cause identified: storage.ts line 220 uses platform-specific path.sep for splitting
  - Solution: Use cross-platform path separator handling (split by both / and \)
  - Severity: HIGH - Data loss for cross-platform users
  - Documentation: See .ralph/docs/issue_10349_analysis.md for detailed analysis
  - Impact: Affects users syncing data between Windows and Unix-like systems
  - Note: Awaiting write permissions to implement fix

- [ ] Issue #10348: Grok Code Fast 1 disappeared from OpenCode Zen
  - Labels: bug,zen

- [ ] Issue #10346: opentui: fatal: undefined is not an object (evaluating 'local.agent.current().name')
  - Labels: bug,opentui

- [ ] Issue #10345: [FEATURE]: Terminal long output lacks scrollbar for quick navigation
  - Labels: opentui,discussion

- [ ] Issue #10344: opentui: fatal: undefined is not an object (evaluating 'local.agent.current().name')
  - Labels: bug,opentui

- [ ] Issue #10343: Misleading Tip about location of custom-tools
  - Labels: bug,docs

- [ ] Issue #10342: /compact doesn't utilize prompt caching
  - Labels: bug

- [ ] Issue #10341: Scoop-fixes-opencode-windows-x64-garbled-output-issue-but-cause-unknown
  - Labels: opentui,windows

- [ ] Issue #10339: [FEATURE]: Add visual indicator for subagent status (running, error, finished)
  - Labels: opentui,discussion

Total: 10 issues
