# OS-Aware Command Transformation for Bash Tool

## TL;DR

> **Quick Summary**: Add automatic Unix-to-Windows command transformation in the Bash tool so Windows users can seamlessly use Unix commands (ls, rm, cp, etc.) without errors. The system will detect the shell type (Git Bash/PowerShell/CMD), transform commands with flags to Windows equivalents, and provide helpful errors for unsupported operations.

> **Deliverables**:
>
> - Shell detection enhancement (distinguish PowerShell vs CMD vs Git Bash)
> - Command transformation utility with full flag transformation
> - Safe list of 13 commands with validation for risky operations
> - Integration with bash.ts for automatic transformation
> - Comprehensive test coverage (unit + integration)
> - Clear error messages with suggestions

> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Shell Detection → Transform Utility → Integration → Tests

---

## Context

### Original Request

Windows users encounter "command not found" errors when using Unix commands like `ls`, `rm`, `export` in the Bash tool. This affects basic operations: file listing, environment variables, file deletion. CI/CD scenarios are particularly impacted (e.g., `export CI=true DEBIAN_FRONTEND=noninteractive`).

### Interview Summary

**Key Discussions**:

- **Scope**: Safe list of 13 commands (ls, rm, cp, mv, cat, mkdir, export, which, pwd, touch, clear, ps, kill) with full flag transformation
- **Behavior**: Always transform on Windows (no opt-in needed)
- **Shell Priority**: Git Bash first (no transform needed), then PowerShell, then CMD
- **Error Handling**: Fail with helpful error + suggestions for unsupported commands
- **Test Strategy**: Full TDD coverage

**Research Findings**:

- Current bash.ts passes commands AS-IS to shell (no transformation)
- Shell detection exists but can't distinguish PowerShell from CMD
- Windows path handling exists (Filesystem.windowsPath)
- tree-sitter already used for command parsing (can be reused)
- Best practices: Use argument arrays, handle quoting differences, test edge cases

### Metis Review

**Identified Gaps** (all addressed):

- **CRITICAL**: Flag transformation approach → User chose full transformation
- **CRITICAL**: Safe list scope → User chose full list with validation
- **GUARDRAILS**: Added explicit MUST NOT list (no transform in quotes, pipes, chains)
- **ACCEPTANCE CRITERIA**: Added shell detection accuracy, argument preservation, quote handling
- **EDGE CASES**: Added commands in quotes, native Windows commands, empty commands

---

## Work Objectives

### Core Objective

Implement OS-aware command transformation in the Bash tool that automatically detects the Windows shell type and transforms Unix commands to Windows equivalents, enabling seamless cross-platform usage without user configuration.

### Concrete Deliverables

- `packages/opencode/src/util/shell.ts` - Enhanced shell detection (detectShellType function)
- `packages/opencode/src/util/command.ts` - Command transformation utility
- `packages/opencode/src/tool/bash.ts` - Integration of transformation logic
- `packages/opencode/test/util/command.test.ts` - Unit tests for transformation
- `packages/opencode/test/bash-windows.test.ts` - Integration tests
- Error message documentation with suggestions

### Definition of Done

- [ ] All 13 safe list commands transform correctly for PowerShell and CMD
- [ ] Shell detection accurately identifies Git Bash, PowerShell, and CMD
- [ ] Flag transformation works (e.g., `ls -la` → `Get-ChildItem -Force -Hidden`)
- [ ] Commands in quotes are NOT transformed
- [ ] Native Windows commands bypass transformation
- [ ] Clear error messages for unsupported commands
- [ ] All tests pass: `bun test packages/opencode/test/`
- [ ] Manual verification on Windows: commands work in all shells

### Must Have

- Shell detection that distinguishes PowerShell vs CMD vs Git Bash
- Command transformation for safe list (13 commands)
- Flag transformation for common flags
- Error messages with actionable suggestions
- Quote handling (no transform inside quotes)
- Native command bypass
- Unit tests with ≥90% coverage
- Integration tests covering shell detection + transformation

### Must NOT Have (Guardrails)

- NO transformation of commands inside single/double quotes
- NO transformation of pipe chains (`ls | grep foo`)
- NO transformation of command chains (`mkdir foo && cd foo`)
- NO transformation of command substitution (`$(cmd)` or backticks)
- NO transformation within workdir parameter
- NO external dependencies for transformation logic
- NO attempt to transform complex shell scripts
- NO path transformation in command arguments (separate concern)
- NO transformation when shell is Git Bash (native Unix support)
- NO silent failures - always error clearly for unsupported commands

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD (Test-Driven Development)
- **Framework**: bun test
- **TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Unit Tests**: Use `bun test` — Verify transformation logic, shell detection, flag mapping
- **Integration Tests**: Use `bun test` with mock shells — Test end-to-end transformation flow
- **Manual QA**: Use actual Windows environment — Verify commands work in real PowerShell/CMD

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — research + validation):
├── Task 1: Shell detection feasibility validation [quick]
└── Task 2: Command usage audit [quick]

Wave 2 (After Wave 1 — design + implementation, MAX PARALLEL):
├── Task 3: Command transformation spec design [coding-aux]
├── Task 4: Shell detection enhancement [coding-aux]
└── Task 5: Command transformation utility [coding-aux]

Wave 3 (After Wave 2 — integration + verification):
├── Task 6: Integration in bash.ts [coding-aux]
└── Task 7: Integration tests [coding-aux]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA on Windows (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1/2 → Task 3/4/5 → Task 6 → Task 7 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Waves 1 & 2)
```

### Dependency Matrix

- **1-2**: — — 3, 4, 5
- **3**: 1, 2 — 5, 6
- **4**: 1 — 5, 6
- **5**: 3, 4 — 6
- **6**: 3, 5 — 7
- **7**: 6 — F1-F4

> This matrix shows ALL dependencies. Each task blocks downstream tasks as shown.

### Agent Dispatch Summary

- **Wave 1**: **2** — T1 → `quick` (git-master), T2 → `quick` (git-master)
- **Wave 2**: **3** — T3 → `coding-aux`, T4 → `coding-aux` (tdd-workflow), T5 → `coding-aux` (tdd-workflow)
- **Wave 3**: **2** — T6 → `coding-aux` (tdd-workflow, git-master), T7 → `coding-aux` (tdd-workflow)
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [ ] 1. Shell Detection Feasibility Validation

  **What to do**:
  - Research how to distinguish PowerShell vs CMD vs Git Bash on Windows
  - Check if current `Shell.acceptable()` in `packages/opencode/src/shell/shell.ts` can be enhanced
  - Investigate environment variables: `$PSModulePath` (PowerShell), `$COMSPEC` (CMD)
  - Check for executable paths: `pwsh.exe`, `powershell.exe`, `cmd.exe`, `bash.exe`
  - Document approach: new function `detectShellType()` or enhance existing `Shell.acceptable()`
  - Provide code examples for detection logic

  **Must NOT do**:
  - Implement the detection logic yet (only research and document)
  - Add external dependencies
  - Modify existing shell detection behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Research and documentation task, no complex implementation
  - **Skills**: [`git-master`]
    - `git-master`: Needed to navigate codebase and understand existing shell detection patterns
  - **Skills Evaluated but Omitted**:
    - `tdd-workflow`: No tests needed for research task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/shell/shell.ts:41-69` - Current shell detection fallback logic with platform checks
  - `packages/opencode/src/shell/shell.ts:24-39` - Shell blacklisting logic (fish, nu)

  **API/Type References** (contracts to implement against):
  - Node.js `process.env` - Access to environment variables (COMSPEC, PSModulePath, SHELL)
  - Node.js `process.platform` - Platform detection ('win32', 'darwin', 'linux')

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/util/process.test.ts` - Example of testing platform-specific behavior

  **External References** (libraries and frameworks):
  - PowerShell detection: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables
  - Environment variables on Windows: https://ss64.com/nt/syntax-variables.html

  **WHY Each Reference Matters**:
  - `shell.ts:41-69`: Shows current detection pattern - need to understand before extending
  - `shell.ts:24-39`: Demonstrates how to filter/validate shells - can reuse pattern
  - `process.test.ts`: Shows how to test platform-specific code - will need similar approach
  - PowerShell docs: Explains `$PSModulePath` variable unique to PowerShell - key detection method

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Research document created: `.sisyphus/drafts/shell-detection-research.md`
  - [ ] Document includes: 3+ detection approaches with pros/cons
  - [ ] Document includes: code examples for each approach
  - [ ] Document includes: recommendation with rationale

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Research document validates detection approaches
    Tool: Bash (grep, cat)
    Preconditions: Research document exists at .sisyphus/drafts/shell-detection-research.md
    Steps:
      1. grep -c "PowerShell" .sisyphus/drafts/shell-detection-research.md
      2. Assert output contains number >= 3 (PowerShell mentioned at least 3 times)
      3. grep -c "CMD\|cmd.exe" .sisyphus/drafts/shell-detection-research.md
      4. Assert output contains number >= 3 (CMD mentioned at least 3 times)
      5. grep -c "Git Bash\|bash.exe" .sisyphus/drafts/shell-detection-research.md
      6. Assert output contains number >= 3 (Git Bash mentioned at least 3 times)
      7. grep -c "recommendation\|Recommendation\|RECOMMEND" .sisyphus/drafts/shell-detection-research.md
      8. Assert output contains number >= 1 (Recommendation section exists)
    Expected Result: Document covers all three shell types and includes recommendation
    Failure Indicators: grep returns 0 for any shell type, no recommendation found
    Evidence: .sisyphus/evidence/task-1-research-document-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-1-research-document-validation.txt

  **Commit**: NO (research task, no code changes)

- [ ] 2. Command Usage Audit

  **What to do**:
  - Search OpenCode codebase for common Unix command usage patterns
  - Look in test files, documentation, example commands
  - Identify frequency of safe list commands (ls, rm, cp, mv, cat, mkdir, export, which, pwd, touch, clear, ps, kill)
  - Document findings with usage count for each command
  - Validate that safe list covers most common operations
  - Identify any commonly used commands NOT in safe list

  **Must NOT do**:
  - Access user logs or personal data
  - Implement transformation logic yet
  - Modify any code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Audit and documentation task using grep/search
  - **Skills**: [`git-master`]
    - `git-master`: Needed for efficient codebase search using git grep or search tools
  - **Skills Evaluated but Omitted**:
    - `tdd-workflow`: No tests needed for audit task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/tool/bash.txt:1-50` - Examples of commands used in bash tool documentation
  - `packages/opencode/test/tool/bash.test.ts` - Test cases showing actual command usage patterns

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/tool/bash.test.ts:1-400` - Shows variety of commands tested in bash tool

  **WHY Each Reference Matters**:
  - `bash.txt`: Contains documented examples of commands users might type
  - `bash.test.ts`: Shows real command patterns used in tests - reflects common usage

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Usage audit document created: `.sisyphus/drafts/command-usage-audit.md`
  - [ ] Document includes usage count for all 13 safe list commands
  - [ ] Document identifies any commonly used commands NOT in safe list
  - [ ] Document validates safe list coverage (≥80% of common usage)

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Usage audit covers all safe list commands
    Tool: Bash (grep)
    Preconditions: Audit document exists at .sisyphus/drafts/command-usage-audit.md
    Steps:
      1. for cmd in ls rm cp mv cat mkdir export which pwd touch clear ps kill; do grep -q "$cmd" .sisyphus/drafts/command-usage-audit.md && echo "PASS: $cmd" || echo "FAIL: $cmd"; done
      2. Assert all 13 commands show "PASS"
      3. grep -c "usage count\|frequency\|Usage" .sisyphus/drafts/command-usage-audit.md
      4. Assert output contains number >= 10 (usage statistics included)
    Expected Result: All safe list commands documented with usage statistics
    Failure Indicators: Any command shows "FAIL", no usage statistics found
    Evidence: .sisyphus/evidence/task-2-usage-audit-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-2-usage-audit-validation.txt

  **Commit**: NO (audit task, no code changes)

- [ ] 3. Command Transformation Spec Design

  **What to do**:
  - Create detailed specification for command transformation logic
  - Document command parsing approach (reuse tree-sitter or use regex/string parsing)
  - Define safe list mapping table with PowerShell and CMD equivalents for all 13 commands
  - Specify flag transformation rules (e.g., `-la` → `-Force -Hidden`, `-r` → `-Recurse`)
  - Define quote detection algorithm (identify quoted strings to skip transformation)
  - Design error message format with suggestions
  - Include at least 20 example transformations covering:
    - Simple commands (ls, pwd, which)
    - Commands with flags (ls -la, rm -rf)
    - Commands with paths (cat file.txt, cp src dest)
    - Edge cases (commands in quotes, native Windows commands)
  - Define validation rules for risky commands (rm, kill, export)

  **Must NOT do**:
  - Implement any code yet
  - Add external dependencies
  - Define complex shell script transformation

  **Recommended Agent Profile**:
  - **Category**: `coding-aux`
    - Reason: Technical specification design requiring coding knowledge
  - **Skills**: []
    - No special skills needed - this is a design/documentation task
  - **Skills Evaluated but Omitted**:
    - `tdd-workflow`: No tests for spec document
    - `git-master`: Minimal codebase navigation needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 5, 6
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/tool/bash.ts:84-142` - Tree-sitter parsing for command extraction
  - `packages/opencode/src/util/filesystem.ts:121-133` - Windows path transformation pattern

  **API/Type References** (contracts to implement against):
  - `packages/opencode/src/shell/shell.ts` - Shell type interface will need extension

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/tool/bash.test.ts` - Examples of command parsing tests

  **External References** (libraries and frameworks):
  - PowerShell command reference: https://learn.microsoft.com/en-us/powershell/module/
  - Windows CMD reference: https://ss64.com/nt/
  - shell-quote library: https://github.com/ljharb/shell-quote (for parsing patterns)

  **WHY Each Reference Matters**:
  - `bash.ts:84-142`: Shows existing tree-sitter usage - can reuse for command parsing
  - `filesystem.ts:121-133`: Demonstrates transformation pattern - similar approach for commands
  - PowerShell/CMD docs: Need accurate command equivalents for mapping table
  - shell-quote: Alternative parsing approach if tree-sitter insufficient

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Spec document created: `.sisyphus/drafts/command-transform-spec.md`
  - [ ] Document includes: Command mapping table (13 commands × 2 shells = 26 mappings)
  - [ ] Document includes: Flag transformation rules (≥10 flag mappings)
  - [ ] Document includes: Quote detection algorithm
  - [ ] Document includes: ≥20 example transformations
  - [ ] Document includes: Error message templates
  - [ ] Document includes: Validation rules for risky commands

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Spec document covers all required sections
    Tool: Bash (grep)
    Preconditions: Spec document exists at .sisyphus/drafts/command-transform-spec.md
    Steps:
      1. grep -c "Command Mapping Table\|command mapping" .sisyphus/drafts/command-transform-spec.md
      2. Assert output contains number >= 1 (mapping table exists)
      3. grep -c "Flag Transformation\|flag mapping" .sisyphus/drafts/command-transform-spec.md
      4. Assert output contains number >= 1 (flag rules exist)
      5. grep -c "Quote Detection\|quote detection" .sisyphus/drafts/command-transform-spec.md
      6. Assert output contains number >= 1 (quote detection section exists)
      7. grep -c "Example Transformation\|example" .sisyphus/drafts/command-transform-spec.md
      8. Assert output contains number >= 20 (at least 20 examples)
      9. grep -c "Error Message\|error message" .sisyphus/drafts/command-transform-spec.md
      10. Assert output contains number >= 1 (error message section exists)
    Expected Result: All specification sections present with required content
    Failure Indicators: Any section has count < 1, examples < 20
    Evidence: .sisyphus/evidence/task-3-spec-document-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-3-spec-document-validation.txt

  **Commit**: NO (spec task, no code changes)

- [ ] 4. Shell Detection Enhancement Implementation

  **What to do**:
  - Add new `detectShellType()` function to `packages/opencode/src/shell/shell.ts`
  - Function returns: `'bash' | 'powershell' | 'cmd' | null`
  - Detection logic:
    - Check if shell path contains `bash.exe` → return `'bash'`
    - Check if shell path contains `pwsh.exe` or `powershell.exe` → return `'powershell'`
    - Check if shell path contains `cmd.exe` or `COMSPEC` env → return `'cmd'`
    - Otherwise return `null`
  - Add comprehensive unit tests in `packages/opencode/test/util/shell.test.ts`
  - Test cases:
    - Git Bash detection (various paths)
    - PowerShell detection (pwsh.exe, powershell.exe)
    - CMD detection (cmd.exe, COMSPEC)
    - Unknown shell (returns null)
    - Case-insensitive path matching
  - Export new function from shell.ts

  **Must NOT do**:
  - Modify existing `Shell.acceptable()` behavior
  - Add external dependencies
  - Transform any commands in this task

  **Recommended Agent Profile**:
  - **Category**: `coding-aux`
    - Reason: Implementation of utility function with clear requirements
  - **Skills**: [`tdd-workflow`]
    - `tdd-workflow`: TDD approach required - write tests first, then implementation
  - **Skills Evaluated but Omitted**:
    - `git-master`: Straightforward implementation, minimal git navigation needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 5)
  - **Blocks**: Task 5, 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/shell/shell.ts:41-69` - Current shell detection fallback logic
  - `packages/opencode/src/shell/shell.ts:24-39` - Shell blacklisting pattern

  **API/Type References** (contracts to implement against):
  - Node.js `process.env` - Environment variable access
  - Node.js `path` module - Path manipulation for checking executable names

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/util/process.test.ts` - Platform-specific test patterns
  - `packages/opencode/test/util/filesystem.test.ts` - Utility function test patterns

  **External References** (libraries and frameworks):
  - Node.js path module: https://nodejs.org/api/path.html

  **WHY Each Reference Matters**:
  - `shell.ts:41-69`: Existing detection logic to understand and extend
  - `process.test.ts`: Shows how to test platform-specific behavior
  - `filesystem.test.ts`: Demonstrates testing utility functions
  - Node.js path docs: Needed for path.basename() or path parsing

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Test file created: `packages/opencode/test/util/shell.test.ts`
  - [ ] Tests written FIRST (RED phase) covering all 5 test cases
  - [ ] Implementation in `packages/opencode/src/shell/shell.ts` makes tests pass (GREEN phase)
  - [ ] `bun test packages/opencode/test/util/shell.test.ts` → PASS (all tests)

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Shell detection tests pass for all shell types
    Tool: Bash (bun test)
    Preconditions: Shell detection implementation complete
    Steps:
      1. cd packages/opencode && bun test test/util/shell.test.ts
      2. Assert exit code is 0
      3. Assert output contains "detectShellType" test suite
      4. Assert output shows all tests passing (0 failures)
      5. grep -c "bash\|powershell\|cmd" test/util/shell.test.ts
      6. Assert output contains number >= 3 (all three shell types tested)
    Expected Result: All shell detection tests pass
    Failure Indicators: Exit code ≠ 0, any test failures, missing shell type tests
    Evidence: .sisyphus/evidence/task-4-shell-detection-tests.txt
  ```

  ```
  Scenario: Shell detection function exports correctly
    Tool: Bash (grep)
    Preconditions: Implementation in src/shell/shell.ts
    Steps:
      1. grep -n "export.*detectShellType\|export function detectShellType" packages/opencode/src/shell/shell.ts
      2. Assert output contains line number (function is exported)
      3. grep -n "detectShellType.*bash.*powershell.*cmd" packages/opencode/src/shell/shell.ts
      4. Assert output contains line number (return type includes all shell types)
    Expected Result: Function properly exported with correct type signature
    Failure Indicators: No export found, incorrect return type
    Evidence: .sisyphus/evidence/task-4-shell-detection-export.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-4-shell-detection-tests.txt
  - [ ] Evidence file: task-4-shell-detection-export.txt

  **Commit**: YES
  - Message: `feat(shell): add detectShellType function for Windows shell identification`
  - Files: `packages/opencode/src/shell/shell.ts`, `packages/opencode/test/util/shell.test.ts`
  - Pre-commit: `cd packages/opencode && bun test test/util/shell.test.ts`

- [ ] 5. Command Transformation Utility Implementation

  **What to do**:
  - Create new file: `packages/opencode/src/util/command.ts`
  - Implement `transformCommand(command: string, shellType: string, cwd: string): string` function
  - Safe list mapping table (13 commands):
    ```typescript
    const SAFE_COMMANDS = {
      ls: { powershell: "Get-ChildItem", cmd: "dir" },
      rm: { powershell: "Remove-Item", cmd: "del", validate: true },
      cp: { powershell: "Copy-Item", cmd: "copy" },
      mv: { powershell: "Move-Item", cmd: "move" },
      cat: { powershell: "Get-Content", cmd: "type" },
      mkdir: { powershell: "New-Item -Type Directory", cmd: "mkdir" },
      export: { powershell: "$env:", cmd: "set", validate: true },
      which: { powershell: "Get-Command", cmd: "where" },
      pwd: { powershell: "Get-Location", cmd: "cd" },
      touch: { powershell: "$null >", cmd: "type nul >" },
      clear: { powershell: "Clear-Host", cmd: "cls" },
      ps: { powershell: "Get-Process", cmd: "tasklist", validate: true },
      kill: { powershell: "Stop-Process", cmd: "taskkill", validate: true },
    }
    ```
  - Flag transformation mapping:
    ```typescript
    const FLAG_MAPS = {
      ls: { "-l": "", "-a": "-Force", "-la": "-Force -Hidden", "-lh": "-Force -Hidden" },
      rm: { "-r": "-Recurse", "-f": "-Force", "-rf": "-Recurse -Force" },
      cp: { "-r": "-Recurse", "-f": "-Force" },
      mkdir: { "-p": "" }, // PowerShell/CMD create parents by default
      // ... more flag mappings
    }
    ```
  - Quote detection: Use regex to identify quoted strings (`'...'` and `"..."`) and skip transformation
  - Native command bypass: Check if command already exists in Windows (dir, copy, del, etc.)
  - Error handling: For commands not in safe list, throw error with suggestion:
    ```
    Error: Command 'grep' is not in the safe list for automatic transformation.
    Suggestion: Use 'findstr' (CMD) or 'Select-String' (PowerShell) instead.
    ```
  - Validation for risky commands: Log warning or require explicit confirmation for `rm`, `kill`, `export`, `ps`
  - Write comprehensive unit tests: `packages/opencode/test/util/command.test.ts`
  - Test cases:
    - Simple command transformation (all 13 commands)
    - Command with single flag transformation
    - Command with multiple flags transformation
    - Commands in quotes (no transformation)
    - Native Windows commands (no transformation)
    - Unknown command error with suggestion
    - Risky command validation
    - Path arguments preserved correctly
    - Empty command handling

  **Must NOT do**:
  - Transform commands in pipes (`|`)
  - Transform commands in chains (`&&`, `||`)
  - Transform command substitution (`$()`)
  - Add external dependencies
  - Transform when shellType is 'bash'

  **Recommended Agent Profile**:
  - **Category**: `coding-aux`
    - Reason: Core utility implementation with clear specification
  - **Skills**: [`tdd-workflow`]
    - `tdd-workflow`: TDD approach mandatory - comprehensive test coverage required
  - **Skills Evaluated but Omitted**:
    - `git-master`: New file creation, minimal codebase navigation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 3, 4

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/util/filesystem.ts:121-133` - Windows path transformation pattern
  - `packages/opencode/src/tool/bash.ts:84-142` - Tree-sitter parsing pattern (if reusing)

  **API/Type References** (contracts to implement against):
  - `detectShellType()` from Task 4 - Shell type input
  - Node.js `process.platform` - Platform check

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/util/filesystem.test.ts` - Utility function test patterns
  - `packages/opencode/test/tool/bash.test.ts` - Command parsing test patterns

  **External References** (libraries and frameworks):
  - PowerShell command reference: https://learn.microsoft.com/en-us/powershell/module/
  - Windows CMD reference: https://ss64.com/nt/
  - shell-quote: https://github.com/ljharb/shell-quote (if using for parsing)

  **WHY Each Reference Matters**:
  - `filesystem.ts:121-133`: Shows transformation pattern to follow
  - `bash.ts:84-142`: Demonstrates command parsing approach
  - `filesystem.test.ts`: Pattern for testing utility functions
  - PowerShell/CMD docs: Accurate command and flag mappings

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Test file created: `packages/opencode/test/util/command.test.ts`
  - [ ] Tests written FIRST (RED phase) covering all 8+ test scenarios
  - [ ] Implementation makes tests pass (GREEN phase)
  - [ ] `bun test packages/opencode/test/util/command.test.ts` → PASS (≥20 tests)
  - [ ] Test coverage ≥90%

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Command transformation tests pass for all safe list commands
    Tool: Bash (bun test)
    Preconditions: Transformation utility implementation complete
    Steps:
      1. cd packages/opencode && bun test test/util/command.test.ts
      2. Assert exit code is 0
      3. Assert output contains "transformCommand" test suite
      4. Assert output shows all tests passing (0 failures)
      5. Assert output shows ≥20 tests executed
    Expected Result: All transformation tests pass with comprehensive coverage
    Failure Indicators: Exit code ≠ 0, any test failures, < 20 tests
    Evidence: .sisyphus/evidence/task-5-transformation-tests.txt
  ```

  ```
  Scenario: Transformation utility handles all safe list commands
    Tool: Bash (bun test with custom script)
    Preconditions: Implementation in src/util/command.ts
    Steps:
      1. Create temp test script that imports transformCommand
      2. Test each safe list command: ls, rm, cp, mv, cat, mkdir, export, which, pwd, touch, clear, ps, kill
      3. For each command, verify PowerShell and CMD equivalents returned
      4. Assert all 13 commands have mappings for both shells
    Expected Result: All safe list commands transform correctly
    Failure Indicators: Any command missing mapping, incorrect transformation
    Evidence: .sisyphus/evidence/task-5-safe-list-coverage.txt
  ```

  ```
  Scenario: Quote handling prevents transformation
    Tool: Bash (bun test)
    Preconditions: Quote detection implemented
    Steps:
      1. bun test test/util/command.test.ts -t "quote"
      2. Assert tests pass for commands inside single quotes
      3. Assert tests pass for commands inside double quotes
      4. Assert output shows quote handling tests passing
    Expected Result: Commands in quotes are not transformed
    Failure Indicators: Quote tests fail, transformation occurs inside quotes
    Evidence: .sisyphus/evidence/task-5-quote-handling.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-5-transformation-tests.txt
  - [ ] Evidence file: task-5-safe-list-coverage.txt
  - [ ] Evidence file: task-5-quote-handling.txt

  **Commit**: YES
  - Message: `feat(command): add Unix-to-Windows command transformation utility`
  - Files: `packages/opencode/src/util/command.ts`, `packages/opencode/test/util/command.test.ts`
  - Pre-commit: `cd packages/opencode && bun test test/util/command.test.ts`

- [ ] 6. Integration in bash.ts

  **What to do**:
  - Modify `packages/opencode/src/tool/bash.ts` to use command transformation
  - Import `detectShellType()` and `transformCommand()` at top of file
  - Add transformation call in `execute()` function (around line 83, before tree-sitter parsing):

    ```typescript
    // Detect shell type
    const shellType = detectShellType(shell)

    // Transform command if on Windows and not using Git Bash
    const transformedCommand =
      process.platform === "win32" && shellType !== "bash"
        ? transformCommand(params.command, shellType, cwd)
        : params.command

    // Use transformed command for parsing
    const tree = await parser().then((p) => p.parse(transformedCommand))
    ```

  - Add debug logging when transformation occurs:
    ```typescript
    if (transformedCommand !== params.command) {
      log.info("command transformed", {
        original: params.command,
        transformed: transformedCommand,
        shellType,
      })
    }
    ```
  - Pass `transformedCommand` to `spawn()` instead of `params.command` (line 172)
  - Handle transformation errors gracefully:
    ```typescript
    let transformedCommand: string
    try {
      transformedCommand =
        process.platform === "win32" && shellType !== "bash"
          ? transformCommand(params.command, shellType, cwd)
          : params.command
    } catch (error) {
      // If transformation fails, return helpful error message
      return {
        title: "Command Transformation Error",
        metadata: { output: error.message, exit: 1, description: params.description },
        output: error.message,
      }
    }
    ```
  - Update tool description in `bash.txt` to mention Windows transformation
  - Add tests to `packages/opencode/test/tool/bash.test.ts` for Windows transformation scenarios

  **Must NOT do**:
  - Modify tree-sitter parsing logic
  - Change permission system behavior
  - Affect non-Windows platforms

  **Recommended Agent Profile**:
  - **Category**: `coding-aux`
    - Reason: Integration task connecting existing components
  - **Skills**: [`tdd-workflow`, `git-master`]
    - `tdd-workflow`: Add tests for integration scenarios
    - `git-master`: Navigate existing bash.ts implementation carefully
  - **Skills Evaluated but Omitted**:
    - None - both skills relevant

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (depends on Task 5)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 3, 5

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/tool/bash.ts:55-77` - Tool definition pattern
  - `packages/opencode/src/tool/bash.ts:78-272` - Execute function structure

  **API/Type References** (contracts to implement against):
  - `detectShellType()` from Task 4
  - `transformCommand()` from Task 5
  - Tool.Context interface from `packages/opencode/src/tool/tool.ts`

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/tool/bash.test.ts` - Existing bash tool tests

  **WHY Each Reference Matters**:
  - `bash.ts:55-77`: Shows where to add imports and how tool is structured
  - `bash.ts:78-272`: Execute function to modify - understand flow before changing
  - `bash.test.ts`: Existing tests to extend with transformation scenarios

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Tests added to `packages/opencode/test/tool/bash.test.ts` for Windows transformation
  - [ ] Tests cover: command transformation, Git Bash bypass, error handling
  - [ ] `bun test packages/opencode/test/tool/bash.test.ts` → PASS
  - [ ] Debug logging works (verify with log inspection)

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Bash tool imports transformation utilities
    Tool: Bash (grep)
    Preconditions: Integration in bash.ts complete
    Steps:
      1. grep -n "import.*detectShellType" packages/opencode/src/tool/bash.ts
      2. Assert output contains line number (import exists)
      3. grep -n "import.*transformCommand" packages/opencode/src/tool/bash.ts
      4. Assert output contains line number (import exists)
      5. grep -n "transformCommand.*params.command" packages/opencode/src/tool/bash.ts
      6. Assert output contains line number (transformation call exists)
    Expected Result: Bash tool imports and uses transformation utilities
    Failure Indicators: Missing imports, no transformation call
    Evidence: .sisyphus/evidence/task-6-integration-imports.txt
  ```

  ```
  Scenario: Bash tool tests pass with transformation integration
    Tool: Bash (bun test)
    Preconditions: Tests added for transformation scenarios
    Steps:
      1. cd packages/opencode && bun test test/tool/bash.test.ts
      2. Assert exit code is 0
      3. Assert output shows all tests passing
      4. grep -c "transform\|Transform" test/tool/bash.test.ts
      5. Assert output contains number >= 3 (transformation tests exist)
    Expected Result: Bash tool tests pass with new transformation logic
    Failure Indicators: Exit code ≠ 0, no transformation tests found
    Evidence: .sisyphus/evidence/task-6-integration-tests.txt
  ```

  ```
  Scenario: Transformation only occurs on Windows
    Tool: Bash (grep + bun test)
    Preconditions: Platform check implemented
    Steps:
      1. grep -n "process.platform.*win32" packages/opencode/src/tool/bash.ts
      2. Assert output contains line number (platform check exists)
      3. grep -n "shellType.*bash" packages/opencode/src/tool/bash.ts
      4. Assert output contains line number (Git Bash bypass exists)
    Expected Result: Transformation conditionally applied based on platform and shell
    Failure Indicators: No platform check, no Git Bash bypass
    Evidence: .sisyphus/evidence/task-6-platform-check.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-6-integration-imports.txt
  - [ ] Evidence file: task-6-integration-tests.txt
  - [ ] Evidence file: task-6-platform-check.txt

  **Commit**: YES
  - Message: `feat(bash): integrate command transformation for Windows compatibility`
  - Files: `packages/opencode/src/tool/bash.ts`, `packages/opencode/test/tool/bash.test.ts`, `packages/opencode/src/tool/bash.txt`
  - Pre-commit: `cd packages/opencode && bun test test/tool/bash.test.ts`

- [ ] 7. Integration Tests

  **What to do**:
  - Create comprehensive integration test file: `packages/opencode/test/bash-windows.test.ts`
  - Test scenarios:
    1. **Shell Detection Integration**:
       - Mock different shell environments (Git Bash, PowerShell, CMD)
       - Verify `detectShellType()` returns correct type
    2. **Command Transformation Flow**:
       - Test full flow: shell detection → command transformation → execution
       - Verify transformed command is used in spawn
    3. **End-to-End Scenarios**:
       - `ls` on Windows with PowerShell → verify `Get-ChildItem` used
       - `ls` on Windows with Git Bash → verify no transformation
       - `rm -rf dir` on Windows → verify validation warning
       - Commands in quotes → verify no transformation
       - Unknown command → verify helpful error message
    4. **Error Handling**:
       - Transformation failure → graceful error message
       - Unsupported command → actionable suggestion
    5. **Cross-Platform Behavior**:
       - Unix platform → no transformation regardless of shell
       - Windows with Git Bash → no transformation
  - Use mock shell environments where possible
  - Test with actual shell commands on Windows CI if available
  - Verify debug logging output

  **Must NOT do**:
  - Test actual destructive commands (rm -rf /)
  - Require real Windows environment for all tests
  - Slow down test suite significantly

  **Recommended Agent Profile**:
  - **Category**: `coding-aux`
    - Reason: Test file creation with integration scenarios
  - **Skills**: [`tdd-workflow`]
    - `tdd-workflow`: TDD approach - write tests, verify they pass
  - **Skills Evaluated but Omitted**:
    - `git-master`: Test file creation, minimal navigation

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (depends on Task 6)
  - **Blocks**: Final verification wave
  - **Blocked By**: Task 6

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/test/tool/bash.test.ts` - Existing bash tool test patterns
  - `packages/opencode/test/util/process.test.ts` - Platform-specific test patterns

  **API/Type References** (contracts to implement against):
  - BashTool from `packages/opencode/src/tool/bash.ts`
  - detectShellType from `packages/opencode/src/shell/shell.ts`
  - transformCommand from `packages/opencode/src/util/command.ts`

  **Test References** (testing patterns to follow):
  - `packages/opencode/test/tool/bash.test.ts` - Integration test structure

  **WHY Each Reference Matters**:
  - `bash.test.ts`: Shows how to test bash tool execution
  - `process.test.ts`: Demonstrates testing platform-specific behavior
  - All three APIs: Need to test integration of all components working together

  **Acceptance Criteria**:

  > **AGENT-EXECUTABLE VERIFICATION ONLY** — No human action permitted.

  **If TDD (tests enabled):**
  - [ ] Test file created: `packages/opencode/test/bash-windows.test.ts`
  - [ ] All 5 test scenarios covered
  - [ ] `bun test packages/opencode/test/bash-windows.test.ts` → PASS
  - [ ] Integration tests cover happy path + error cases

  **QA Scenarios (MANDATORY — task is INCOMPLETE without these):**

  ```
  Scenario: Integration tests cover all required scenarios
    Tool: Bash (bun test + grep)
    Preconditions: Integration test file created
    Steps:
      1. grep -c "Shell Detection\|shell detection" packages/opencode/test/bash-windows.test.ts
      2. Assert output contains number >= 1 (shell detection tests exist)
      3. grep -c "Command Transformation\|command transformation" packages/opencode/test/bash-windows.test.ts
      4. Assert output contains number >= 1 (transformation tests exist)
      5. grep -c "End-to-End\|end-to-end\|integration" packages/opencode/test/bash-windows.test.ts
      6. Assert output contains number >= 1 (E2E tests exist)
      7. grep -c "Error Handling\|error handling" packages/opencode/test/bash-windows.test.ts
      8. Assert output contains number >= 1 (error tests exist)
      9. grep -c "Cross-Platform\|cross-platform\|Git Bash" packages/opencode/test/bash-windows.test.ts
      10. Assert output contains number >= 1 (cross-platform tests exist)
    Expected Result: All 5 test scenarios covered
    Failure Indicators: Any scenario count < 1
    Evidence: .sisyphus/evidence/task-7-integration-test-coverage.txt
  ```

  ```
  Scenario: Integration tests pass successfully
    Tool: Bash (bun test)
    Preconditions: All integration tests implemented
    Steps:
      1. cd packages/opencode && bun test test/bash-windows.test.ts
      2. Assert exit code is 0
      3. Assert output contains "bash-windows" test suite
      4. Assert output shows all tests passing (0 failures)
      5. Assert output shows ≥10 tests executed
    Expected Result: All integration tests pass
    Failure Indicators: Exit code ≠ 0, any test failures, < 10 tests
    Evidence: .sisyphus/evidence/task-7-integration-tests-pass.txt
  ```

  **Evidence to Capture**:
  - [ ] Evidence file: task-7-integration-test-coverage.txt
  - [ ] Evidence file: task-7-integration-tests-pass.txt

  **Commit**: YES
  - Message: `test(bash): add comprehensive integration tests for Windows command transformation`
  - Files: `packages/opencode/test/bash-windows.test.ts`
  - Pre-commit: `cd packages/opencode && bun test test/bash-windows.test.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: NO (research task)
- **2**: NO (audit task)
- **3**: NO (spec task)
- **4**: `feat(shell): add detectShellType function for Windows shell identification` — packages/opencode/src/shell/shell.ts, packages/opencode/test/util/shell.test.ts — `cd packages/opencode && bun test test/util/shell.test.ts`
- **5**: `feat(command): add Unix-to-Windows command transformation utility` — packages/opencode/src/util/command.ts, packages/opencode/test/util/command.test.ts — `cd packages/opencode && bun test test/util/command.test.ts`
- **6**: `feat(bash): integrate command transformation for Windows compatibility` — packages/opencode/src/tool/bash.ts, packages/opencode/test/tool/bash.test.ts, packages/opencode/src/tool/bash.txt — `cd packages/opencode && bun test test/tool/bash.test.ts`
- **7**: `test(bash): add comprehensive integration tests for Windows command transformation` — packages/opencode/test/bash-windows.test.ts — `cd packages/opencode && bun test test/bash-windows.test.ts`

---

## Success Criteria

### Verification Commands

```bash
# All unit tests pass
cd packages/opencode && bun test test/util/shell.test.ts
cd packages/opencode && bun test test/util/command.test.ts

# All integration tests pass
cd packages/opencode && bun test test/tool/bash.test.ts
cd packages/opencode && bun test test/bash-windows.test.ts

# All tests in package pass
cd packages/opencode && bun test

# Type checking passes
cd packages/opencode && bun run tsc --noEmit
```

### Final Checklist

- [ ] All "Must Have" present
  - [ ] Shell detection distinguishes PowerShell vs CMD vs Git Bash
  - [ ] Command transformation for all 13 safe list commands
  - [ ] Flag transformation works
  - [ ] Commands in quotes NOT transformed
  - [ ] Native Windows commands bypass transformation
  - [ ] Clear error messages with suggestions
  - [ ] Unit tests with ≥90% coverage
  - [ ] Integration tests covering all scenarios
- [ ] All "Must NOT Have" absent
  - [ ] NO transformation in quotes
  - [ ] NO pipe transformation
  - [ ] NO chain transformation
  - [ ] NO external dependencies
  - [ ] NO path transformation in arguments
  - [ ] NO transformation when Git Bash
  - [ ] NO silent failures
- [ ] All tests pass
- [ ] Type checking passes
- [ ] Manual QA on Windows validates real-world usage
