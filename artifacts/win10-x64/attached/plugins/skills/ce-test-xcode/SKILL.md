---
name: ce-test-xcode
description: "Build and test iOS apps on simulator using XcodeBuildMCP. Use after making iOS code changes, before creating a PR, or when verifying app behavior and checking for crashes on simulator."
argument-hint: "[scheme name or 'current' to use default]"
disable-model-invocation: true
---

# Xcode Test Skill

Build, install, and test iOS apps on the simulator using XcodeBuildMCP. Captures screenshots, logs, and verifies app behavior.

## Prerequisites

- Xcode installed with command-line tools
- XcodeBuildMCP MCP server connected
- Valid Xcode project or workspace
- At least one iOS Simulator available

## Workflow

### 0. Verify XcodeBuildMCP is Available

Check that the XcodeBuildMCP MCP server is connected by calling its `list_simulators` tool.

MCP tool names vary by platform:
- Claude Code: `mcp__xcodebuildmcp__list_simulators`
- Other platforms: use the equivalent MCP tool call for the `XcodeBuildMCP` server's `list_simulators` method

If the tool is not found or errors, inform the user they need to add the XcodeBuildMCP MCP server:

```
XcodeBuildMCP not installed

Install via Homebrew:
  brew tap getsentry/xcodebuildmcp && brew install xcodebuildmcp

Or via npx (no global install needed):
  npx -y xcodebuildmcp@latest mcp

Then add "XcodeBuildMCP" as an MCP server in your agent configuration
and restart your agent.
```

Do NOT proceed until XcodeBuildMCP is confirmed working.

### 1. Discover Project and Scheme

Call XcodeBuildMCP's `discover_projs` tool to find available projects, then `list_schemes` with the project path to get available schemes.

If an argument was provided, use that scheme name. If "current", use the default/last-used scheme.

### 2. Boot Simulator

Call `list_simulators` to find available simulators. Boot the preferred simulator (iPhone 15 Pro recommended) using `boot_simulator` with the simulator's UUID.

Wait for the simulator to be ready before proceeding.

### 3. Build the App

Call `build_ios_sim_app` with the project path and scheme name.

**On failure:**
- Capture build errors
- Report to user with specific error details

**On success:**
- Note the built app path for installation
- Proceed to step 4

### 4. Install and Launch

1. Call `install_app_on_simulator` with the built app path and simulator UUID
2. Call `launch_app_on_simulator` with the bundle ID and simulator UUID
3. Call `capture_sim_logs` with the simulator UUID and bundle ID to start log capture

### 5. Test Key Screens

For each key screen in the app:

**Take screenshot:**
Call `take_screenshot` with the simulator UUID and a descriptive filename (e.g., `screen-home.png`).

**Review screenshot for:**
- UI elements rendered correctly
- No error messages visible
- Expected content displayed
- Layout looks correct

**Check logs for errors:**
Call `get_sim_logs` with the simulator UUID. Look for:
- Crashes
- Exceptions
- Error-level log messages
- Failed network requests

**Known automation limitation — SwiftUI Text links:**
Simulated taps (via XcodeBuildMCP or any simulator automation tool) do not trigger gesture recognizers on SwiftUI `Text` views with inline `AttributedString` links. Taps report success but have no effect. This is a platform limitation — inline links are not exposed as separate elements in the accessibility tree. When a tap on a Text link has no visible effect, prompt the user to tap manually in the simulator. If the target URL is known, `xcrun simctl openurl <device> <URL>` can open it directly as a fallback.

### 6. Human Verification (When Required)

Pause for human input when testing touches flows that require device interaction.

| Flow Type | What to Ask |
|-----------|-------------|
| Sign in with Apple | "Please complete Sign in with Apple on the simulator" |
| Push notifications | "Send a test push and confirm it appears" |
| In-app purchases | "Complete a sandbox purchase" |
| Camera/Photos | "Grant permissions and verify camera works" |
| Location | "Allow location access and verify map updates" |
| SwiftUI Text links | "Please tap on [element description] manually — automated taps cannot trigger inline text links" |

Ask the user using the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question:

```
Human Verification Needed

This test requires [flow type]. Please:
1. [Action to take on simulator]
2. [What to verify]

Did it work correctly?
1. Yes - continue testing
2. No - describe the issue
```

### 7. Handle Failures

When a test fails:

1. **Document the failure:**
   - Take screenshot of error state
   - Capture console logs
   - Note reproduction steps

2. **Ask the user how to proceed:**

   ```
   Test Failed: [screen/feature]

   Issue: [description]
   Logs: [relevant error messages]

   How to proceed?
   1. Fix now - debug, propose a fix, rebuild and retest
   2. Skip - continue testing other screens
   ```

3. **If "Fix now":** investigate, propose a fix, rebuild and retest
4. **If "Skip":** log as skipped, continue

### 8. Test Summary

After all tests complete, present a summary:

```markdown
## Xcode Test Results

**Project:** [project name]
**Scheme:** [scheme name]
**Simulator:** [simulator name]

### Build: Success / Failed

### Screens Tested: [count]

| Screen | Status | Notes |
|--------|--------|-------|
| Launch | Pass | |
| Home | Pass | |
| Settings | Fail | Crash on tap |
| Profile | Skip | Requires login |

### Console Errors: [count]
- [List any errors found]

### Human Verifications: [count]
- Sign in with Apple: Confirmed
- Push notifications: Confirmed

### Failures: [count]
- Settings screen - crash on navigation

### Result: [PASS / FAIL / PARTIAL]
```

### 9. Cleanup

After testing:

1. Call `stop_log_capture` with the simulator UUID
2. Optionally call `shutdown_simulator` with the simulator UUID

## Quick Usage Examples

```bash
# Test with default scheme
/ce-test-xcode

# Test specific scheme
/ce-test-xcode MyApp-Debug

# Test after making changes
/ce-test-xcode current
```

## Integration with ce-code-review

When reviewing PRs that touch iOS code, the `ce-code-review` workflow can spawn an agent to run this skill, build on the simulator, test key screens, and check for crashes.
