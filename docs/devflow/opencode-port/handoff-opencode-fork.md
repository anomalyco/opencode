# Handoff: OpenCode Fork Track

## Objective

Work on the OpenCode fork track for devflow. OpenCode is the long-term target
harness. Claude Code remains supported, but new compatibility work should make
OpenCode capable of enforcing the same workflow boundaries.

## Working Directory

Use this repository for OpenCode work:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode
```

Current local state:
- Cloned from `https://github.com/anomalyco/opencode`.
- Current branch after clone: `dev`.
- Upstream default branch: `dev`.
- Current base SHA: `387220f368ca3a31d94b4be3937d9d825ebd888c`.
- Local branches created: `devflow/base`, `devflow/hojo`.
- No `jvanzyl/opencode` GitHub fork existed at initialization time.

Do not push until a fork remote is intentionally created or selected.

## Devflow Planning Docs

Use these docs in the devflow repo as the source of truth:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode
docs/devflow/opencode-port/02-proposal.md
docs/devflow/opencode-port/03-plan.md
docs/devflow/opencode-port/opencode-fork-prs.md
docs/devflow/opencode-port/parity-matrix.md
docs/devflow/opencode-port/gap-log.md
docs/devflow/opencode-port/rebase-log.md
docs/devflow/opencode-port/verification-log.md
docs/devflow/opencode-port/build-commands.md
```

Update the docs before claiming any compatibility improvement.
Use `build-commands.md` for exact package-level build and test commands.

## First Fork Task

Start by establishing the fork tracking mechanics, not by applying patches.

1. In `/Users/jvanzyl/js/jopen/hojo-opencode`, verify clean status:

   ```bash
   git status --short --branch
   git branch --list 'devflow/*'
   ```

2. Decide whether to create a GitHub fork remote. If yes, create it explicitly
   and document the remote in `opencode-fork-prs.md`.

3. For each required PR in `opencode-fork-prs.md`, capture current upstream
   state with:

   ```bash
   gh pr view <number> --repo anomalyco/opencode --json number,state,mergedAt,closedAt,headRefOid,title,url
   ```

4. Do not apply any PR until its tracker row has upstream state, head SHA,
   devflow gap, expected validation, and risk.

## Required PR Stack

Apply in isolated branches first, then stack into `devflow/hojo`.

1. Lifecycle hooks: `#15224`, `#16598`, `#23650`.
2. Hook context improvements: `#15412`, `#21773`.
3. Permission/tool hook correctness: `#19470`, `#22654`, `#20053`, `#21150`.
4. Optional rules loader: `#18903` first; evaluate `#10090` later.

Required PRs for baseline parity:
- `#16598` session.stopping
- `#15412` parent agent context
- `#19470` permission.ask
- `#22654` ask in tool.execute.before
- `#20053` mutable tool args
- `#21150` post-MCP tool.execute.after timing

## Documentation Discipline

Every absorbed PR must update:
- `opencode-fork-prs.md`: upstream state, upstream head, fork branch, fork commit, status.
- `gap-log.md`: gap status and closure evidence.
- `parity-matrix.md`: parity status for affected area.
- `verification-log.md`: commands/tests run.
- `rebase-log.md`: only when rebasing `devflow/hojo` onto upstream.

If a PR merges upstream, remove the local patch at the next rebase and record
the drop in `rebase-log.md`.

## Guardrails

- Keep the patch stack small and explicit.
- Do not absorb broad unrelated OpenCode features.
- Do not make devflow depend on implicit `.claude/rules/` loading; mandatory
  rules still come through `opencode.json` `instructions`.
- Do not duplicate devflow Python enforcement logic into OpenCode unless a hook
  cannot be adapted.
- No parity claim without evidence in `verification-log.md`.
