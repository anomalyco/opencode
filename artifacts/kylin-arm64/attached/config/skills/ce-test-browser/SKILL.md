---
name: ce-test-browser
description: Run browser tests on pages affected by current PR or branch
argument-hint: "[PR number, branch name, 'current', or --port PORT]"
---

# Browser Test Skill

Run end-to-end browser tests on pages affected by a PR or branch changes using the `agent-browser` CLI.

## Use `agent-browser` Only For Browser Automation

This workflow uses the `agent-browser` CLI exclusively. Do not use any alternative browser automation system, browser MCP integration, or built-in browser-control tool. If the platform offers multiple ways to control a browser, always choose `agent-browser`.

Use `agent-browser` for: opening pages, clicking elements, filling forms, taking screenshots, and scraping rendered content.

Platform-specific hints:
- In Claude Code, do not use Chrome MCP tools (`mcp__claude-in-chrome__*`).
- In Codex, do not substitute unrelated browsing tools.

## Prerequisites

- Local development server running (e.g., `bin/dev`, `rails server`, `npm run dev`)
- `agent-browser` CLI installed (see Setup below)
- Git repository with changes to test

## Setup

Check whether `agent-browser` is installed:

```bash
command -v agent-browser >/dev/null 2>&1 && echo "Installed" || echo "NOT INSTALLED"
```

If not installed, inform the user: "`agent-browser` is not installed. Run `/ce-setup` to install required dependencies." Then stop — this skill cannot function without agent-browser.

## Workflow

### 1. Verify Installation

Before starting, verify `agent-browser` is available:

```bash
command -v agent-browser >/dev/null 2>&1 && echo "Ready" || echo "NOT INSTALLED"
```

If not installed, inform the user: "`agent-browser` is not installed. Run `/ce-setup` to install required dependencies." Then stop.

### 2. Ask Browser Mode

**Pipeline mode (`mode:pipeline`):** Skip this step entirely. Default to headless — no question, no blocking. Proceed directly to step 3.

**Manual mode:** Ask the user whether to run headed or headless using the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to presenting options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question:

```
Do you want to watch the browser tests run?

1. Headed (watch) - Opens visible browser window so you can see tests run
2. Headless (faster) - Runs in background, faster but invisible
```

Store the choice and use the `--headed` flag when the user selects option 1.

### 3. Determine Test Scope

**If PR number provided:**
```bash
gh pr view [number] --json files -q '.files[].path'
```

**If 'current' or empty:**
```bash
git diff --name-only main...HEAD
```

**If branch name provided:**
```bash
git diff --name-only main...[branch]
```

### 4. Map Files to Routes

Map changed files to testable routes:

| File Pattern | Route(s) |
|-------------|----------|
| `app/views/users/*` | `/users`, `/users/:id`, `/users/new` |
| `app/controllers/settings_controller.rb` | `/settings` |
| `app/javascript/controllers/*_controller.js` | Pages using that Stimulus controller |
| `app/components/*_component.rb` | Pages rendering that component |
| `app/views/layouts/*` | All pages (test homepage at minimum) |
| `app/assets/stylesheets/*` | Visual regression on key pages |
| `app/helpers/*_helper.rb` | Pages using that helper |
| `src/app/*` (Next.js) | Corresponding routes |
| `src/components/*` | Pages using those components |

Build a list of URLs to test based on the mapping.

### 5. Detect and Claim a Free Port

**Pipeline mode only (`mode:pipeline`):** When invoked from LFG or another automated pipeline, always find a port that is actually free — never assume 3000 is available, as multiple agents may be running in parallel on the same machine.

**Manual mode (no `mode:pipeline`):** Use the preferred port as-is. Do not scan for alternatives — the user controls their own server.

Determine the preferred port using this priority:

1. **Explicit argument** — if the user passed `--port 5000`, use that directly (skip free-port scan)
2. **Project instructions** — check `AGENTS.md`, `CLAUDE.md`, or other instruction files for port references
3. **package.json** — check dev/start scripts for `--port` flags
4. **Environment files** — check `.env`, `.env.local`, `.env.development` for `PORT=`
5. **Default** — fall back to `3000`

**In pipeline mode**, verify the preferred port is free and scan upward if not. **In manual mode**, use the preferred port directly.

```bash
# Step 1: Determine preferred port
PORT="${EXPLICIT_PORT:-}"
if [ -z "$PORT" ]; then
  PORT=$(grep -Eio '(port\s*[:=]\s*|localhost:)([0-9]{4,5})' AGENTS.md 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi
if [ -z "$PORT" ]; then
  PORT=$(grep -Eio '(port\s*[:=]\s*|localhost:)([0-9]{4,5})' CLAUDE.md 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi
if [ -z "$PORT" ]; then
  PORT=$(grep -Eo '\-\-port[= ]+[0-9]{4,5}' package.json 2>/dev/null | grep -Eo '[0-9]{4,5}' | head -1)
fi
if [ -z "$PORT" ]; then
  PORT=$(grep -h '^PORT=' .env .env.local .env.development 2>/dev/null | tail -1 | cut -d= -f2)
fi
PORT="${PORT:-3000}"

# Step 2 (pipeline mode only): scan for a free port
if [ "${PIPELINE_MODE}" = "1" ]; then
  find_free_port() {
    local p=$1
    while lsof -i ":$p" -sTCP:LISTEN -t >/dev/null 2>&1; do
      p=$((p + 1))
    done
    echo $p
  }
  PORT=$(find_free_port "$PORT")
fi
echo "Using dev server port: $PORT"
```

Set `PIPELINE_MODE=1` in your shell when the argument `mode:pipeline` is present.

### 6. Start Dev Server if Not Running, Then Verify

**Pipeline mode only:** If no server is already listening on `$PORT`, start one automatically in the background. In manual mode, inform the user and stop.

```bash
if lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server already running on port ${PORT}"
else
  if [ "${PIPELINE_MODE}" = "1" ]; then
    # Auto-start in pipeline — pick the right command for this project
    echo "Starting dev server on port ${PORT}..."
    if [ -f "bin/dev" ]; then
      PORT=${PORT} bin/dev > /tmp/dev-server-${PORT}.log 2>&1 &
    elif [ -f "bin/rails" ]; then
      bin/rails server -p ${PORT} > /tmp/dev-server-${PORT}.log 2>&1 &
    elif [ -f "package.json" ]; then
      PORT=${PORT} npm run dev > /tmp/dev-server-${PORT}.log 2>&1 &
    fi
    # Wait up to 30 seconds for server to become ready
    for i in $(seq 1 30); do
      lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1 && break
      sleep 1
    done
    if ! lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "Server did not start in 30s. Last output:"
      tail -20 /tmp/dev-server-${PORT}.log 2>/dev/null
      exit 1
    fi
  else
    # Manual mode — ask the user to start the server
    echo "Server not running on port ${PORT}"
    echo ""
    echo "Please start your development server:"
    echo "  Rails: bin/dev  or  rails server -p ${PORT}"
    echo "  Node/Next.js: npm run dev"
    echo "  Custom port: run this skill again with --port <your-port>"
    exit 0
  fi
fi

agent-browser open http://localhost:${PORT}
agent-browser snapshot -i
```

### 7. Test Each Affected Page

For each affected route:

**Navigate and capture snapshot:**
```bash
agent-browser open "http://localhost:${PORT}/[route]"
agent-browser snapshot -i
```

**For headed mode:**
```bash
agent-browser --headed open "http://localhost:${PORT}/[route]"
agent-browser --headed snapshot -i
```

**Verify key elements:**
- Use `agent-browser snapshot -i` to get interactive elements with refs
- Page title/heading present
- Primary content rendered
- No error messages visible
- Forms have expected fields

**Test critical interactions:**
```bash
agent-browser click @e1
agent-browser snapshot -i
```

**Take screenshots:**
```bash
agent-browser screenshot page-name.png
agent-browser screenshot --full page-name-full.png
```

### 8. Human Verification (When Required)

Pause for human input when testing touches flows that require external interaction:

| Flow Type | What to Ask |
|-----------|-------------|
| OAuth | "Please sign in with [provider] and confirm it works" |
| Email | "Check your inbox for the test email and confirm receipt" |
| Payments | "Complete a test purchase in sandbox mode" |
| SMS | "Verify you received the SMS code" |
| External APIs | "Confirm the [service] integration is working" |

Ask the user (using the platform's question tool, or present numbered options and wait):

```
Human Verification Needed

This test touches [flow type]. Please:
1. [Action to take]
2. [What to verify]

Did it work correctly?
1. Yes - continue testing
2. No - describe the issue
```

### 9. Handle Failures

When a test fails:

1. **Document the failure:**
   - Screenshot the error state: `agent-browser screenshot error.png`
   - Note the exact reproduction steps

2. **Ask the user how to proceed:**

   ```
   Test Failed: [route]

   Issue: [description]
   Console errors: [if any]

   How to proceed?
   1. Fix now - debug and fix the failing test
   2. Skip - continue testing other pages
   ```

3. **If "Fix now":** investigate, propose a fix, apply, re-run the failing test
4. **If "Skip":** log as skipped, continue

### 10. Test Summary

After all tests complete, present a summary:

```markdown
## Browser Test Results

**Test Scope:** PR #[number] / [branch name]
**Server:** http://localhost:${PORT}

### Pages Tested: [count]

| Route | Status | Notes |
|-------|--------|-------|
| `/users` | Pass | |
| `/settings` | Pass | |
| `/dashboard` | Fail | Console error: [msg] |
| `/checkout` | Skip | Requires payment credentials |

### Console Errors: [count]
- [List any errors found]

### Human Verifications: [count]
- OAuth flow: Confirmed
- Email delivery: Confirmed

### Failures: [count]
- `/dashboard` - [issue description]

### Result: [PASS / FAIL / PARTIAL]
```

## Quick Usage Examples

```bash
# Test current branch changes (auto-detects port)
/ce-test-browser

# Test specific PR
/ce-test-browser 847

# Test specific branch
/ce-test-browser feature/new-dashboard

# Test on a specific port
/ce-test-browser --port 5000
```

## agent-browser CLI Reference

Run `agent-browser --help` for all commands.

Key commands:

```bash
# Navigation
agent-browser open <url>           # Navigate to URL
agent-browser back                 # Go back
agent-browser close                # Close browser

# Snapshots (get element refs)
agent-browser snapshot -i          # Interactive elements with refs (@e1, @e2, etc.)
agent-browser snapshot -i --json   # JSON output

# Interactions (use refs from snapshot)
agent-browser click @e1            # Click element
agent-browser fill @e1 "text"      # Fill input
agent-browser type @e1 "text"      # Type without clearing
agent-browser press Enter          # Press key

# Screenshots
agent-browser screenshot out.png       # Viewport screenshot
agent-browser screenshot --full out.png # Full page screenshot

# Headed mode (visible browser)
agent-browser --headed open <url>      # Open with visible browser
agent-browser --headed click @e1       # Click in visible browser

# Wait
agent-browser wait @e1             # Wait for element
agent-browser wait 2000            # Wait milliseconds
```
