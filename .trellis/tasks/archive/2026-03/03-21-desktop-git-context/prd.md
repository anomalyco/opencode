# Desktop Git Context

## Goal

Add lightweight Git context to the desktop session composer so users can see the current branch and workspace context before sending a prompt, then expand a popover for nearby Git details.

## Scope

- Show current branch in the prompt tray
- Show whether the current directory is the primary workspace or a sandbox/worktree
- Add a popover with:
  - repo name
  - current directory
  - worktree root
  - local branches
  - known workspaces/worktrees for the current project

## Data Flow

Backend `vcs.get` returns:
- current branch
- local branches
- parsed git worktrees

Frontend consumes:
- `sync.data.vcs`
- `sync.data.path`
- `sync.project`

## Non-Goals

- branch checkout
- branch creation
- dirty/ahead/behind status
- full Git side panel

## Milestones

1. Extend VCS API shape
2. Regenerate SDK
3. Render composer Git chip
4. Render Git context popover
5. Typecheck targeted packages
