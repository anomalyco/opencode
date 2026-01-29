<!--
D.E.K.N. Summary - 30-second handoff for fresh Claude
Fill this at the END of your investigation, before marking Complete.
-->

## Summary (D.E.K.N.)

**Delta:** OAuth priority fix from commit 1e69d9b03 was lost - the anthropic custom loader logic that prioritizes OAuth over API key was stripped in commit 77e60ac7e.

**Evidence:** Diffed current dev branch anthropic loader (lines 88-99 - only returns headers) against backup-dev-pre-sync branch (full OAuth priority logic with auth.access handling).

**Knowledge:** Commit 77e60ac7e moved stealth HEADERS to llm.ts but removed the KEY PRIORITY LOGIC from provider.ts. OAuth users with both OAuth and API key will use API key (wrong).

**Next:** Cherry-pick 1e69d9b03 to restore OAuth priority logic, then re-apply stealth header changes on top.

**Promote to Decision:** recommend-no (tactical fix - restoring lost functionality)

---

# Investigation: Verify OpenCode OAuth Priority Fix

**Question:** Was commit 1e69d9b03 (OAuth priority fix) lost from the current dev branch?

**Started:** 2026-01-29
**Updated:** 2026-01-29
**Owner:** Worker agent
**Phase:** Complete
**Next Step:** None
**Status:** Complete

---

## Findings

### Finding 1: Commit 1e69d9b03 exists only in backup-dev-pre-sync branch

**Evidence:**
```
$ git branch --contains 1e69d9b03
  backup-dev-pre-sync
```

The commit is NOT in the current dev branch.

**Source:** `git branch --contains 1e69d9b03`

**Significance:** Confirms the OAuth priority fix was lost during some sync operation.

---

### Finding 2: Current anthropic custom loader is stripped down

**Evidence:** Current code at `packages/opencode/src/provider/provider.ts:88-99`:
```typescript
const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic() {
      return {
        autoload: false,
        options: {
          headers: {
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }
    },
```

Compare to backup-dev-pre-sync which had:
- `async anthropic(input)` - takes input parameter
- Auth.get("anthropic") check
- OAuth token priority: `auth?.type === "oauth"` → `auth.access`
- API key fallback: `auth?.type === "api"` → `auth.key`
- Environment variable fallback
- Stealth headers for OAuth
- authToken option for OAuth tokens

**Source:**
- Current: `packages/opencode/src/provider/provider.ts:88-99`
- Backup: `git show backup-dev-pre-sync:packages/opencode/src/provider/provider.ts`

**Significance:** The core OAuth priority logic is completely missing from current dev.

---

### Finding 3: Commit 77e60ac7e caused the regression

**Evidence:**
```
$ git diff 1e69d9b03..77e60ac7e -- packages/opencode/src/provider/provider.ts
```

Shows commit 77e60ac7e removed the full anthropic loader and replaced it with the minimal version. The commit message says "implement full pi-ai stealth mode parity" but it actually REMOVED the OAuth priority logic.

The commit moved stealth HEADERS to llm.ts but removed KEY PRIORITY logic.

**Source:** `git diff 1e69d9b03..77e60ac7e -- packages/opencode/src/provider/provider.ts`

**Significance:** The regression happened in a commit that claimed to ADD stealth mode functionality.

---

### Finding 4: Provider loading doesn't handle OAuth auth type

**Evidence:** In `packages/opencode/src/provider/provider.ts:824-832`:
```typescript
for (const [providerID, provider] of Object.entries(await Auth.all())) {
  if (disabled.has(providerID)) continue
  if (provider.type === "api") {  // <-- Only handles "api" type!
    mergeProvider(providerID, {
      source: "api",
      key: provider.key,
    })
  }
}
```

OAuth auth (type === "oauth") with its `access` property is never loaded into `provider.key`.

**Source:** `packages/opencode/src/provider/provider.ts:824-832`

**Significance:** This is WHY OAuth tokens aren't used - they're never loaded into the provider object.

---

### Finding 5: getSDK has partial OAuth fix but depends on provider.key

**Evidence:** In `packages/opencode/src/provider/provider.ts:976-979`:
```typescript
if (model.api.npm === "@ai-sdk/anthropic" && provider.key.includes("sk-ant-oat")) {
  options["apiKey"] = null
  options["authToken"] = provider.key
}
```

This correctly converts OAuth tokens to authToken, BUT it requires provider.key to already contain the OAuth token - which it won't due to Finding 4.

**Source:** `packages/opencode/src/provider/provider.ts:976-979`

**Significance:** The getSDK fix is useless without the custom loader setting provider.key from OAuth auth.

---

## Synthesis

**Key Insights:**

1. **Two-part fix was split incorrectly** - Commit 1e69d9b03 had OAuth priority in custom loader, commit 77e60ac7e moved headers to llm.ts but removed priority logic, leaving a broken system.

2. **OAuth auth type is ignored** - The provider loading code only handles `type === "api"`, so OAuth tokens are never loaded into provider.key.

3. **Partial fixes exist but don't connect** - getSDK has OAuth→authToken conversion, llm.ts has stealth headers, but neither gets the OAuth token because the custom loader priority logic is gone.

**Answer to Investigation Question:**

YES, the OAuth priority fix from commit 1e69d9b03 was lost. The current dev branch has a stripped-down anthropic custom loader that only returns headers. The key priority logic (OAuth > API key > env var) was removed in commit 77e60ac7e despite that commit claiming to implement stealth mode. Cherry-pick of 1e69d9b03 is required.

---

## Structured Uncertainty

**What's tested:**

- ✅ Commit 1e69d9b03 is NOT in dev branch (verified: `git branch --contains`)
- ✅ Commit 1e69d9b03 IS in backup-dev-pre-sync (verified: `git branch --contains`)
- ✅ Current anthropic loader only returns headers (verified: Read provider.ts:88-99)
- ✅ Commit 77e60ac7e removed the OAuth logic (verified: `git diff 1e69d9b03..77e60ac7e`)

**What's untested:**

- ⚠️ Actual OAuth flow with Claude Max subscription (not tested end-to-end)
- ⚠️ Cherry-pick conflict resolution (commit may not apply cleanly)

**What would change this:**

- If getSDK's partial OAuth handling can work without the custom loader (unlikely - needs provider.key)
- If there's another code path that loads OAuth tokens into provider.key (not found)

---

## Implementation Recommendations

### Recommended Approach ⭐

**Cherry-pick 1e69d9b03** - Restore the OAuth priority logic to the anthropic custom loader

**Why this approach:**
- Directly restores the lost functionality
- The backup-dev-pre-sync branch proves this code worked
- Minimal risk - restoring tested code

**Trade-offs accepted:**
- May have conflicts with current code
- Stealth headers might need reconciliation with llm.ts

**Implementation sequence:**
1. `git cherry-pick 1e69d9b03` - apply the OAuth priority fix
2. Resolve any conflicts (likely in the anthropic custom loader)
3. Test OAuth flow manually
4. Consider consolidating stealth header logic (currently in both loader and llm.ts)

### Alternative Approaches Considered

**Option B: Add OAuth handling to provider loading loop**
- **Pros:** More generic fix, helps other providers too
- **Cons:** Larger change, provider loading logic is complex
- **When to use instead:** If multiple providers need OAuth handling

**Option C: Rewrite from scratch**
- **Pros:** Fresh implementation, can design better
- **Cons:** More work, risk of new bugs
- **When to use instead:** If cherry-pick has too many conflicts

---

## References

**Files Examined:**
- `packages/opencode/src/provider/provider.ts` - Current anthropic loader and getSDK
- `packages/opencode/src/auth/index.ts` - Auth schema showing OAuth vs API types
- `packages/opencode/src/session/llm.ts` - Stealth headers (moved there in 77e60ac7e)

**Commands Run:**
```bash
# Check commit existence
git show 1e69d9b03 --stat
git branch --contains 1e69d9b03
git branch --contains 77e60ac7e

# Compare branches
git log --oneline dev..backup-dev-pre-sync | head -20

# Diff the regression
git diff 1e69d9b03..77e60ac7e -- packages/opencode/src/provider/provider.ts

# View backup branch code
git show backup-dev-pre-sync:packages/opencode/src/provider/provider.ts | head -150
```

**Related Artifacts:**
- **Commit:** 1e69d9b03 - The lost OAuth priority fix
- **Commit:** 77e60ac7e - The regression (despite claiming to add stealth mode)
- **Branch:** backup-dev-pre-sync - Contains the working OAuth code

---

## Investigation History

**2026-01-29 14:30:** Investigation started
- Initial question: Was OAuth priority fix lost?
- Context: Spawned from orchestrator to verify suspected regression

**2026-01-29 14:45:** Confirmed fix is lost
- Commit 1e69d9b03 not in dev branch
- Current anthropic loader is stripped down
- Root cause: commit 77e60ac7e removed the logic

**2026-01-29 15:00:** Investigation completed
- Status: Complete
- Key outcome: Cherry-pick 1e69d9b03 required to restore OAuth priority
