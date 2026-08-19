# Curated agent personas for this repo, and a subagent that audits them

## Why

`/auto` can already delegate — `task` gives a subagent its own session, its own derived
permission ruleset, and `LocalPlacement` routing onto an idle fleet node. What it has
never had is anyone worth delegating *to*.

Two problems, and the first has been silently true for weeks.

**The personas were not loaded at all.** `.opencode/agent/` held ten symlinks pointing at
`/Users/andreas/dev/opencode/.skein/agents/` — a path that stopped existing when this
repo was renamed to `opencode-skein`. Every one of them was dangling, so opencode has
been loading exactly two agents from disk (`duplicate-pr`, `triage`) and ignoring
coder/reviewer/tester/architect/researcher/analyst/debugger/scanner/publisher/idea-reviewer.

**The symlink was the wrong shape regardless.** A `.skein/` directory is *local per-repo
state*, not a shared library — it holds that repo's changes, worktrees, chat sessions and
its own possibly-customised agents. Nothing in this repo should ever symlink into a
`.skein/` directory, its own or another's. What *is* shareable is skein's
`templates/agents/` — the curated defaults skein seeds from. Those are a source of ideas
to copy and adapt, not a target to link.

And adapt is the operative word: the skein templates are written for skein's own Go
codebase and its file-token pipeline. `reviewer.md` says "read changed Go files" and
"write your review to `.skein/review-<name>.md`". Neither is true here. Dropped in
unchanged they would produce confidently wrong work.

**Nobody has checked whether the prompts are any good.** A persona is a system prompt
plus a permission set. Both can be quietly wrong — a "tester" denied `bash` cannot run
tests; a "reviewer" allowed `edit` is not a reviewer. There is no feedback loop that
would ever surface this.

## What Changes

### 1. Real, committed persona files for this repo's stack

`.opencode/agent/` gains a curated set of **regular files, tracked in git** — not
symlinks, not generated. Each is written for what this repo actually is: Bun, TypeScript,
Effect-TS services and layers, SolidJS/opentui for the TUI, `bun run typecheck`,
`bun test`, and openspec changes as the unit of work.

The starting set is the three the queue's gates need plus the two that answer questions:

| agent | mode | for |
| --- | --- | --- |
| `coder` | subagent | implement one `tasks.md` slice |
| `tester` | subagent | write and run tests for a slice |
| `reviewer` | subagent | read finished work, emit a verdict, change nothing |
| `researcher` | subagent | answer a question from the codebase, change nothing |
| `persona-auditor` | subagent | judge whether an agent definition makes an expert |

Skein's `templates/agents/` is credited as the source of the shape. The content is this
repo's.

### 2. Permission sets that match the job

Each persona's `permission` block is derived from what the role must and must not do,
and the spec pins the two that are load-bearing: a reviewer SHALL be denied `write` and
`edit`, and a tester SHALL be allowed `bash`. These are exactly the failures that look
like a bad model and are actually a bad config.

### 3. A persona auditor, and an audit that has actually been run

`persona-auditor` reads an agent definition and judges it against its own stated
`description`: does the prompt make an expert at that, are the permissions coherent with
the instructions, does it reference anything that does not exist in this repo, and would
two personas in the set collide. It emits structured findings and a verdict, and it is
denied `write`/`edit` so it cannot rewrite the thing it is judging.

The change is not done when the auditor exists. It is done when the auditor has been run
over every persona in the set and its findings have been folded back into the files.

## Impact

- `.opencode/agent/` becomes tracked content; the dangling symlinks and their `.gitignore`
  entries go away.
- No change to how skein seeds `.skein/agents/` for other repos. This is about what
  *this* repo ships.
- Prerequisite for `persona-gate-fanout`, which is what actually puts them to work.
