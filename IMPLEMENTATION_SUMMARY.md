# Network Silence Retry Implementation Summary

## Overview

Implemented automatic retry mechanism for immediate network failures in OpenCode when sending requests to LLM providers (zai.coding, kimi-code, etc.). The feature detects connection failures within ~250ms and retries with a fixed 500ms delay until the network self-remediates.

## Problem Statement

When users send requests to certain providers, immediate network failures (ECONNREFUSED, ENOTFOUND, ECONNRESET, etc.) occur within 250ms. These errors were not being retried, causing user frustration. The solution needed to:

- Retry indefinitely until connection self-remediates
- Use exact same request (no token-wasting scaffolding)
- Show visible progress via toast notifications
- Respect cache coherence (identical requests hit cache)

## Solution Architecture

### 1. Error Classification (message-v2.ts)

**New Error Type: NetworkSilenceError**

- Detects network-level failures vs HTTP errors
- Classifies 10 system error codes: ECONNRESET, ECONNREFUSED, ENOTFOUND, EHOSTUNREACH, ENETUNREACH, ETIMEDOUT, EPIPE, EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT, UND_ERR_SOCKET
- Handles both raw system errors and errors wrapped by Vercel AI SDK

**Detection Logic (isNetworkSilence)**

- Checks direct error code
- Checks error.cause (Node wraps system errors)
- Detects TypeError with "fetch failed" messages
- Recursively checks APICallError.cause for wrapped network errors

### 2. Retry Configuration (retry.ts)

**Fixed Delay Strategy**

```typescript
export const NETWORK_SILENCE_DELAY = 500 // Fixed 500ms, no backoff
```

**Detection Function**

```typescript
export function silence(error: ReturnType<NamedError["toObject"]>): boolean {
  return MessageV2.NetworkSilenceError.isInstance(error)
}
```

**Rationale for Fixed Delay:**

- Exponential backoff would waste time on first retry
- 500ms is long enough for network to self-remediate
- Fixed delay ensures identical requests for cache coherence
- No token waste: same request = same tokens = cache hit

### 3. Processor Integration (processor.ts)

**Retry Loop (in error handler)**

- Placed **before** existing `retryable()` check (higher priority)
- No attempt cap (retries until connection works or user aborts)
- Toast shows retry count with "token-aware self-remediation" message
- Status bar reflects retry state
- Respects AbortSignal (user can Ctrl+C)

**Key Features:**

- Infinite retry until connection self-remediates
- Fixed 500ms delay (no exponential backoff)
- Toast notifications per retry with counter
- Status bar integration
- User abort support

## Files Modified

### Core Implementation (3 files, 69 insertions)

1. **packages/opencode/src/session/message-v2.ts** (+53 lines)
   - NetworkSilenceError type definition
   - NETWORK_CODES set (10 error codes)
   - isNetworkSilence() detection function
   - networkMessage() helper for error messages
   - Updated fromError() to classify network silence

2. **packages/opencode/src/session/retry.ts** (+5 lines)
   - NETWORK_SILENCE_DELAY constant (500ms)
   - silence() detection function

3. **packages/opencode/src/session/processor.ts** (+19 lines)
   - TuiEvent import
   - Network silence retry branch in error handler
   - Toast notification publishing
   - Status bar updates

4. **packages/opencode/package.json** (+1 line)
   - Added "dev-install" npm script

### Development Installation (3 files)

1. **packages/opencode/script/dev-install.ts**
   - Builds dev binary with version `dev0.0.1-netdrop-dodged`
   - Installs to system binary directory (~/.local/bin or %LOCALAPPDATA%\opencode\bin)
   - Adds to PATH with helpful instructions
   - Verifies installation

2. **packages/opencode/script/dev-install-path.ps1**
   - PowerShell helper for Windows PATH setup
   - Safe, non-destructive
   - Shows helpful messages

3. **packages/opencode/DEV_INSTALL.md**
   - Complete documentation
   - Platform-specific instructions
   - Troubleshooting guide
   - Development workflow

## Version Scheme

**Dev Version: `dev0.0.1-netdrop-dodged`**

Naming breakdown:

- `dev` - Development release prefix
- `0.0.1` - Feature version number
- `netdrop-dodged` - Feature identifier (network silence retry)

This version is set via environment variable in dev-install.ts:

```typescript
OPENCODE_VERSION: "dev0.0.1-netdrop-dodged",
OPENCODE_CHANNEL: "local",
```

## Installation Locations

**macOS/Linux:** `~/.local/bin/opencode`
**Windows:** `%LOCALAPPDATA%\opencode\bin\opencode.exe`

## Usage

### Install Dev Version

```bash
cd packages/opencode
bun run dev-install
```

This will:

1. Build binary for current platform only
2. Install to system directory
3. Show PATH setup instructions if needed
4. Verify installation with `--version`

### Verify Installation

```bash
opencode --version
# Output: dev0.0.1-netdrop-dodged
```

### Update PATH (if needed)

**Windows:**

```powershell
powershell -ExecutionPolicy Bypass -File script/dev-install-path.ps1
```

**macOS/Linux:**
Add to `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Testing the Feature

### Manual Testing

1. Install dev version: `bun run dev-install`
2. Start OpenCode: `opencode`
3. Create a session with a provider that has network issues
4. Send a prompt
5. Observe:
   - Toast notifications showing "Retry N — token-aware self-remediation due to network silence"
   - Status bar showing retry state
   - Automatic retries every 500ms
   - Connection self-remediates and request succeeds

### Network Silence Scenarios Handled

- `ECONNREFUSED` - Server actively refused connection
- `ECONNRESET` - Connection reset by peer
- `ENOTFOUND` - DNS lookup failed
- `EHOSTUNREACH` - Host unreachable
- `ENETUNREACH` - Network unreachable
- `ETIMEDOUT` - Connection timeout
- `EPIPE` - Broken pipe
- `EAI_AGAIN` - Temporary DNS failure
- `UND_ERR_CONNECT_TIMEOUT` - Undici connection timeout
- `UND_ERR_SOCKET` - Undici socket error
- `TypeError: fetch failed` - Generic fetch failures

## Commits

```
0744e7e1d docs: add dev installation scripts and documentation
6dbb81233 feat: network silence retry with dev installation
```

### Commit 1: Core Implementation

- NetworkSilenceError type and detection
- Retry logic in processor
- dev-install npm script in package.json

### Commit 2: Installation Scripts & Documentation

- dev-install.ts build and install script
- dev-install-path.ps1 Windows PATH helper
- DEV_INSTALL.md comprehensive guide

## Design Decisions

### 1. Fixed 500ms Delay (not exponential backoff)

**Why:**

- Network self-remediation typically happens quickly
- Exponential backoff would waste time on first retry
- Fixed delay ensures cache coherence (identical requests)
- No token waste: same request = same tokens = cache hit

### 2. No Attempt Cap

**Why:**

- Network silence is transient
- Should retry until connection self-remediates
- User can abort with Ctrl+C
- Prevents unnecessary failures from temporary issues

### 3. Toast Notifications per Retry

**Why:**

- Visible feedback that system is working
- Shows retry count for user awareness
- Duration timed to be replaced by next toast (no clutter)
- Uses "warning" variant to indicate temporary issue

### 4. Before Existing Retry Logic

**Why:**

- Network silence is more critical than rate limiting
- Should be prioritized in error handling
- Prevents network errors from being misclassified

### 5. Exact Request Replay

**Why:**

- No message mutation or part appending
- Same request = same tokens = cache hit if partial request got through
- Minimizes token usage during retries
- Ensures idempotency

## Next Steps

1. **Build and Install:**

   ```bash
   cd packages/opencode
   bun run dev-install
   ```

2. **Verify:**

   ```bash
   opencode --version
   # Should output: dev0.0.1-netdrop-dodged
   ```

3. **Test with Network Issues:**
   - Simulate network failures (disconnect WiFi, etc.)
   - Observe automatic retries with toast notifications
   - Verify connection self-remediation works

4. **Gather Feedback:**
   - Test with real providers (zai.coding, kimi-code)
   - Monitor retry frequency and success rates
   - Collect user feedback on UX

5. **Iterate:**
   - Adjust retry delay if needed
   - Add metrics/analytics
   - Consider future enhancements
