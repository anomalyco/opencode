---
description: Sync visual UI changes from sst/opencode upstream
---

You are helping sync VISUAL UI improvements from upstream `sst/opencode` into Forge.

## Context

Forge has architecturally diverged from OpenCode:
- **OpenCode**: Uses provider system (`@/provider/provider`) with bundled AI SDKs
- **Forge**: Uses ACP protocol (`@/acp/`) with agent subprocesses

We care about VISUAL improvements (UI, UX, themes, layouts) in `packages/opencode/`.

## Key Principle: Visual Structure vs Data Source

When syncing visual changes that use backend logic:
- ✅ **Keep**: Visual structure, layout, styling, JSX components
- 🔄 **Adapt**: Data-fetching calls (swap OpenCode APIs for Forge/ACP equivalents)

**Example:**
```typescript
// OpenCode version
const sync = useSync()
const tokenUsage = sync.tokenUsage()

// Adapt to Forge - keep the display, swap the data source
const session = useSession()  // or wherever Forge stores this
const tokenUsage = session.usage()
```

## Workflow

### Step 1: Fetch and Analyze

```bash
git fetch upstream
git log --oneline --reverse origin/dev..upstream/dev -- packages/opencode/
```

Identify commits that improve visual/UI layer:
- New UI components or improvements
- Theme additions/updates
- Layout/styling changes
- UX improvements (animations, indicators)
- Bug fixes in rendering

### Step 2: Create Summary Report

For EACH relevant visual commit, provide:

1. **Commit hash and title**
2. **PR link** - Extract `(#1234)` → `https://github.com/sst/opencode/pull/1234`
   - If no PR: `https://github.com/sst/opencode/commit/<hash>`
3. **Type**: Pure visual OR Visual + backend
4. **Files changed** (TUI/UI focus)
5. **Brief description**

Group commits into **batches of 10** for incremental syncing.

**Format:**
```markdown
## Visual Changes Available from Upstream

Found 27 visual commits. Grouped into 3 batches for incremental syncing.

### Batch 1 (Commits 1-10)

#### 1. [abc123] Add permission indicator to footer
- **PR**: https://github.com/sst/opencode/pull/4813
- **Type**: Pure visual
- **Files**: routes/session/footer.tsx
- **Description**: Visual indicator for permission state

#### 2. [def456] Improve model selection dialog
- **PR**: https://github.com/sst/opencode/pull/5100
- **Type**: Visual + backend
- **Files**: component/dialog-model.tsx
- **Description**: Better filtering UX (uses useSync() - needs adaptation)

... (8 more)

### Batch 2 (Commits 11-20)
...
```

### Step 3: STOP and Wait for Approval

Present the summary and ask: **"Ready to sync Batch 1?"**

DO NOT proceed until user approves.

### Step 4: Sync One Batch at a Time

For the approved batch:

```bash
# Create branch if first batch
git checkout -b sync-upstream-$(date +%Y%m%d)

# Cherry-pick each commit in batch
git cherry-pick <commit-1>
git cherry-pick <commit-2>
...
```

**If conflicts or errors occur:**
- Check for OpenCode-specific imports (`@/provider/provider`)
- Adapt data-fetching to use Forge equivalents
- Keep visual structure, swap data source

### Step 5: Inspect Changes

After cherry-picking the batch, show the user how to inspect:

```bash
# See what files changed in this batch
git diff origin/dev --stat

# See actual changes in specific file
git diff origin/dev -- packages/forge/src/cli/cmd/tui/routes/session/footer.tsx

# See all commits in current branch
git log origin/dev..HEAD --oneline
```

**Verify visually:**
```bash
bun run typecheck  # Check for type errors
bun run dev        # Launch TUI and inspect visual changes
```

**What to check in the TUI:**
- Do the visual improvements appear?
- Are there any import errors or crashes?
- If backend was adapted, does the data display correctly?

### Step 6: Report Results and Wait

After inspecting, report:
- ✅ Commits successfully cherry-picked
- 🔄 Commits that needed adaptation (and what was changed)
- ❌ Commits that failed (and why)

Then ask: **"Batch 1 complete. Ready for Batch 2?"**

Repeat Steps 3-6 for each batch.

### Step 7: Final Verification

After all batches:
```bash
bun test           # Run full test suite
bun run typecheck  # Final type check
bun run dev        # Full TUI test
```

## Common Adaptations Needed

**Provider/Model APIs:**
```typescript
// OpenCode
import { Provider } from "@/provider/provider"
const sync = useSync()
const providers = sync.providers()

// Forge
import { getAllAgents } from "@/acp/agents"
const agents = getAllAgents()
```

**Dialog Components:**
```typescript
// OpenCode
import { DialogModel } from "@tui/component/dialog-model"

// Forge
import { DialogModels } from "@tui/component/dialog-models"
```

**Session/State:**
```typescript
// OpenCode
const sync = useSync()
const currentModel = sync.currentModel()

// Forge
const local = useLocal()
const currentAgent = local.agent.current()
```

## Instructions

When user runs `/sync-upstream`:

1. Fetch and identify visual commits in `packages/opencode/`
2. Categorize and group into batches of 10
3. Present summary with PR links
4. For each batch:
   - Wait for approval
   - Cherry-pick commits
   - Adapt backend calls if needed
   - Show inspection commands
   - Verify visually
   - Report results
   - Wait for next batch approval
5. Final verification after all batches complete

Focus on incremental syncing with verification at each step.
