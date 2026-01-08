# Windows PowerShell Execution Testing Agent

## Mission
Run targeted tests to investigate PowerShell command execution issues on Windows and report back detailed findings.

## Working Directory
You are working in the `e:/code/Opencode-Git-Bash-Forks/opencode` repository (not opencode/Opencode-Git-Bash-Forks).

## Context
We're investigating why PowerShell commands executed via the Bash tool are being "echoed" instead of executed. The devplan is at `devplans/windows-command-execution-issues.md`.

## Tasks

### Task 1: Run the Unit Tests
Execute these tests and report exact results:

```bash
cd e:/code/Opencode-Git-Bash-Forks/opencode
bun test packages/opencode/test/tool/bash-windows.test.ts
```

**Report format:**
```
=== Test Results ===
Test: "parseCommand uses shell wrapper for PowerShell"
Expected: shouldBypassShell = false
Actual: [result]
PASS/FAIL
```

### Task 2: Test PowerShell Execution Directly
Run these commands and capture exact output:

```bash
# Test 1: Simple Write-Host
bash{"command":"powershell -NoProfile -Command \"Write-Host 'HelloWorld'\"","description":"Test simple Write-Host"}

# Test 2: Get-Date
bash{"command":"powershell -NoProfile -Command \"Get-Date\"","description":"Test Get-Date"}

# Test 3: Simple echo
bash{"command":"powershell -Command \"echo test123\"","description":"Test echo"}

# Test 4: Get-Process
bash{"command":"powershell -Command \"Get-Process | Select-Object -First 3\"","description":"Test Get-Process pipeline"}

# Test 5: Multiple statements
bash{"command":"powershell -Command \"Write-Host 'First'; Write-Host 'Second'\"","description":"Test semicolon chaining"}
```

**For each test, report:**
```
Command: [exact command]
Exit code: [number]
Stdout: [exact output from metadata.output]
Expected: [what should happen]
Actual: [what happened]
Status: WORKS / ECHOED
```

### Task 3: Test PS1 Script File Method
Create and execute a PS1 file:

```bash
# Create test script
write_to_file{"path":"test_script.ps1","content":"Write-Host 'Hello from PS1'\n$env:COMPUTERNAME\nGet-Date"}

# Execute
bash{"command":"powershell -ExecutionPolicy Bypass -File test_script.ps1","description":"Test PS1 file execution"}
```

**Report:**
```
Exit code: [value]
Output: [exact output]
Status: WORKS / FAILED
```

### Task 4: Test CMD Wrapper Method
Test the CMD wrapper approach:

```bash
bash{"command":"cmd /c powershell -Command \"Write-Host 'HelloFromCMD'\"","description":"Test CMD wrapper"}
bash{"command":"cmd /c echo hello","description":"Test basic CMD echo"}
```

### Task 5: Check Test File Inconsistency
Compare test expectations:

```bash
grep -n "shouldBypassShell" packages/opencode/src/tool/bash.test.ts
grep -n "shouldBypassShell" packages/opencode/test/tool/bash-windows.test.ts
```

**Report exact line numbers and expected values.**

## Output Format

```
=== POWERSHELL EXECUTION TEST REPORT ===
Date: [timestamp]

=== DIRECT TEST ===
Command: powershell -Command "Write-Host 'HelloWorld'"
Exit code: [number]
Output: [exact output]
Status: WORKS / ECHOED

=== PS1 FILE TEST ===
Command: powershell -File test_script.ps1
Exit code: [value]
Output: [exact output]
Status: WORKS / FAILED

=== CMD WRAPPER TEST ===
Command: cmd /c powershell -Command "..."
Exit code: [value]
Output: [exact output]
Status: WORKS / FAILED

=== TEST INCONSISTENCY ===
bash.test.ts line [X]: shouldBypassShell = [Y]
bash-windows.test.ts line [A]: shouldBypassShell = [B]

=== SUMMARY ===
Direct inline: WORKS / ECHOED
PS1 file: WORKS / FAILED
CMD wrapper: WORKS / FAILED

Root cause: [your analysis]
Recommended fix: [specific code changes]
```

## Important
- Capture exact output, don't summarize
- Test from the opencode directory: `e:/code/Opencode-Git-Bash-Forks/opencode`
- Reference files using relative paths from that directory
