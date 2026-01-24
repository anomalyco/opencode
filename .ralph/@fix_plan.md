# Ralph Fix Plan (GitHub Issues)
Repository: anomalyco/opencode
Updated: 2026-01-24 18:05 UTC

## High Priority

- [x] Issue #10350: Under ulw operation, the agent cannot be invoked.
  - Labels: none
  - Status: **ANALYZED** - Root cause identified: Custom agents with mode="primary" are filtered out from Task tool invocation
  - Documentation: .ralph/docs/issue_10350_analysis.md
  - Solution: Add clear error message when attempting to invoke primary agents as subagents

- [x] Issue #10349: Sessions not visible across platforms when syncing data directory (cross-platform session visibility)
  - Labels: windows
  - Status: **ANALYZED** - Root cause identified: storage.ts line 220 uses platform-specific path.sep for splitting
  - Documentation: .ralph/docs/issue_10349_analysis.md
  - Solution: Use cross-platform path separator handling (split by both / and \)

- [x] Issue #10348: Grok Code Fast 1 disappeared from OpenCode Zen
  - Labels: bug,zen
  - Status: **ANALYZED** - Model deprecation, not a bug
  - Documentation: .ralph/docs/issue_10348_analysis.md

- [x] Issue #10346: opentui: fatal: undefined is not an object (evaluating 'local.agent.current().name')
  - Labels: bug,opentui
  - Status: **ANALYZED** - Null safety issue, fix available
  - Documentation: .ralph/docs/issue_10346_analysis.md

- [x] Issue #10343: Misleading Tip about location of custom-tools
  - Labels: bug,docs
  - Status: **ANALYZED** - Hardcoded path issue
  - Documentation: .ralph/docs/issue_10343_analysis.md

- [x] Issue #10342: /compact doesn't utilize prompt caching
  - Labels: bug
  - Status: **ANALYZED** - Missing cache headers
  - Documentation: .ralph/docs/issue_10342_analysis.md

- [x] Issue #10341: Scoop-fixes-opencode-windows-x64-garbled-output-issue-but-cause-unknown
  - Labels: opentui,windows
  - Status: **ANALYZED** - Terminal encoding mismatch
  - Documentation: .ralph/docs/issue_10341_analysis.md

- [x] Issue #10339: [FEATURE]: Add visual indicator for subagent status (running, error, finished)
  - Labels: opentui,discussion
  - Status: **ANALYZED** - UI enhancement needed
  - Documentation: .ralph/docs/issue_10339_analysis.md

## Remaining Issues (2)

- [x] Issue #10345: [FEATURE]: Terminal long output lacks scrollbar for quick navigation
  - Labels: opentui,discussion
  - Status: **ANALYZED** - Feature request for scrollbar component in OpenTUI
  - Documentation: .ralph/docs/issue_10345_analysis.md
  - Solution: Implement custom scrollbar component in OpenTUI

- [x] Issue #10344: opentui: fatal: undefined is not an object (evaluating 'local.agent.current().name')
  - Labels: bug,opentui
  - Status: **DUPLICATE** - Same issue as #10346, already analyzed
  - Documentation: See .ralph/docs/issue_10346_analysis.md
  - Note: Exact duplicate - same error, same file location, same stack trace

Total: 10 issues | Analyzed: 10 | Remaining: 0

**✅ ALL ISSUES ANALYZED**
