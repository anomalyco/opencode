---
name: worktree
description: Create, list, or remove a git worktree for a Linear ticket. The ticket id is the branch name and the worktree dir name. Use when starting work on a ticket.
allowed-tools: Read, Bash, AskUserQuestion, mcp__linear-axiomic__*
---

# worktree

One worktree per ticket. **Convention: ticket-id == branch name == worktree dir name**
(e.g. `AX-123`). Plain `git worktree` — no stack bring-up here (run `/stack` separately
if a repo has one). Single repo: no submodules, no pointer bumps.

## Config discovery
Read `.axiomic.toml`: `default_base`. Read `.claude/axiomic-shared.toml`: `linear_team`
(the ticket-id pattern is `<linear_team>-\d+`).
Resolve `REPO_ROOT=$(git rev-parse --show-toplevel)`.
Worktrees live in a sibling dir so they never pollute the repo tree:
`WT_BASE="$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-worktrees"`.

## Ticket detection
Resolve the ticket from (in order): the worktree dir basename, `git branch
--show-current`, then `$ARGUMENTS` — first match of `<linear_team>-\d+`.

## Commands
Parse `$ARGUMENTS` for `create | list | remove | status | diff` (default: `create`).

### `create <TICKET> [--from <ref>]`
1. **Pick the base ref:**
   - `--from <ref>` if given.
   - else look up the ticket in Linear (`mcp__linear-axiomic__get_issue`); if it has a **parent
     issue** and that parent's branch exists (`git branch -r | grep <PARENT>`), base on
     it (epic-branch model).
   - else `default_base`.
2. `git fetch origin <base>`.
3. `git worktree add -b "<TICKET>" "$WT_BASE/<TICKET>" "origin/<base>"`
   (if the branch already exists, drop `-b` and check it out).
4. **Seed the workspace** (gitignored scratch) inside the new worktree:
   - Ensure `workspace/` is ignored: if `workspace/` isn't in the worktree's
     `.gitignore`, append it. Create `workspace/plans/` and `workspace/notes/`.
   - Write `workspace/context.md` with the ticket id, title, and description pulled
     from `mcp__linear-axiomic__get_issue` (Overview / FRs / NFRs / Success Criteria).
5. **Move the ticket to "In Progress"** — creating the worktree is the moment work starts,
   so this is where the status is written:
   ```
   mcp__linear-axiomic__save_issue(id: "<issue id>", state: "In Progress")
   ```
6. **Verify** before reporting: the worktree is on branch `<TICKET>`
   (`git -C "$WT_BASE/<TICKET>" branch --show-current`), based on the intended ref,
   `workspace/` exists and is gitignored, and the **main checkout is untouched**
   (`git -C "$REPO_ROOT" status -s` shows nothing new).
7. Report the worktree path, branch, and base. Next step: `cd` into the worktree, then
   `/plan`.

### `list`
`git worktree list` plus, for each, its branch and matching ticket.

### `status [TICKET]`
For the given (or current) worktree: `git status -s` and `git log --oneline origin/<base>..HEAD`.

### `diff [TICKET]`
For the given (or current) worktree, show its changes vs the base:
`git -C "$WT_BASE/<TICKET>" diff "origin/<base>...HEAD" --stat`, then the full diff.

### `remove <TICKET>`
1. Show uncommitted/unpushed work in that worktree; if any, `AskUserQuestion`
   (continue / abort) before destroying it.
2. `git worktree remove "$WT_BASE/<TICKET>"` (add `--force` only after the user
   confirms there's nothing to keep).
3. Offer to delete the branch (`git branch -d <TICKET>`); never force-delete unmerged
   work without explicit confirmation.

## Notes
- Never bring up Docker/stacks here.
- The worktree dir is a sibling of the repo and is gitignored at the workspace level —
  it won't show up in the repo's own status.

---

$ARGUMENTS
