# Project Plugin Scope Leak

## Problem

Project-level plugins should only affect the project that defines them.

Current observed behavior shows cross-project leakage:

- `opencode/.opencode/plugin/math-check-auto.ts` exists only in the `opencode` repo
- a session opened under `/Users/lelouch/pyope` received:
  - `session.error`
  - error text: `Command not found: "math-check"`
- the error then triggered the desktop error sound

This means plugin behavior from one repo was active while handling a different repo session.

## Repro

- Keep local `opencode` project configured with project plugin files under `.opencode/plugin/`
- Open an unrelated project such as `/Users/lelouch/pyope`
- Run a session that produces math-heavy output
- Observe `math-check-auto` behavior leaking into the unrelated project and triggering `session.command({ command: "math-check" })`

## Goal

Guarantee that project-local plugin discovery, loading, caching, and hook execution are scoped to the correct project/worktree/session directory and cannot leak across unrelated projects.

## Known Facts

- OpenCode auto-discovers project plugins from `.opencode/plugin/` and `.opencode/plugins/`
- `math-check-auto.ts` is a plugin hook, not a command definition
- the failing `math-check` lookup happens through the command registry, not through bash/tool resolution
- the `pyope` project does not define `math-check`

## Investigation Targets

- config loading order and project root selection in `packages/opencode/src/config/config.ts`
- whether plugin lists are cached globally instead of per directory/context
- whether `Plugin.init()` runs once with a stale project context and survives project switches
- whether Quick Assistant or bootstrap code merges config from the wrong root
- whether command lookup and plugin hook execution use different config scopes

## Hypotheses

- Plugin hooks are initialized once and reused globally, while later sessions run under different directories
- Config/plugin discovery uses the wrong root after switching projects
- A cached plugin list outlives the project it came from

## Success Criteria

- reproduce the scope leak with logs
- identify the exact stale scope boundary
- implement per-project/plugin isolation
- verify that project plugins from `opencode` do not fire in `pyope`
- keep valid project-local plugin behavior working inside the originating project
