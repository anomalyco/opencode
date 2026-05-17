---
description: "Trellis Copilot prompt: Method 1: Simple parameters"
---

[!] **Prerequisite**: This command should only be used AFTER the human has tested and committed the code.

**Do NOT run `git commit` directly** — the scripts below handle their own commits for `.trellis/` metadata. You only need to read git history (`git log`, `git status`, `git diff`) and run the Python scripts.

---

## Record Work Progress

### Step 1: Get Context & Check Tasks

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

[!] Archive tasks whose work is **actually done** — judge by work status, not the `status` field in task.json:
- Code committed? → Archive it (don't wait for PR)
- All acceptance criteria met? → Archive it
- Don't skip archiving just because `status` still says `planning` or `in_progress`

```bash
python3 ./.trellis/scripts/task.py archive <task-name>
```

### Step 2: One-Click Add Session

```bash
# Method 1: Simple parameters
python3 ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary of what was done"

# Method 2: Pass detailed content via stdin
cat << 'EOF' | python3 ./.trellis/scripts/add_session.py --stdin --title "Title" --commit "hash"
| Feature | Description |
|---------|-------------|
| New API | Added user authentication endpoint |
| Frontend | Updated login form |

**Updated Files**:
- `packages/api/modules/auth/router.ts`
- `apps/web/modules/auth/components/login-form.tsx`
EOF
```

**Auto-completes**:
- [OK] Appends session to journal-N.md
- [OK] Auto-detects line count, creates new file if >2000 lines
- [OK] Auto-detects Branch context (`--branch` override; otherwise Branch = task.json -> current git branch; missing values are omitted gracefully)
- [OK] Updates index.md (Total Sessions +1, Last Active, line stats, history)
- [OK] Auto-commits .trellis/workspace and .trellis/tasks changes

---

## Script Command Reference

| Command | Purpose |
|---------|---------|
| `python3 ./.trellis/scripts/get_context.py --mode record` | Get context for record-session |
| `python3 ./.trellis/scripts/add_session.py --title "..." --commit "..."` | **One-click add session (recommended, branch auto-complete)** |
| `python3 ./.trellis/scripts/task.py archive <name>` | Archive completed task (auto-commits) |
| `python3 ./.trellis/scripts/task.py list` | List active tasks |
