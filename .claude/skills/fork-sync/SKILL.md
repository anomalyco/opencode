---
name: fork-sync
description: Sync opencode-skein with upstream opencode, and interpret fork:verify. Use when merging upstream, when fork:verify fails, when a fork feature seems to have vanished, when bumping the fork manifest baseline, or before any merge that touches files the fork owns or patches.
---

# fork-sync

opencode-skein is a fork of `anomalyco/opencode` carrying ~270 commits of its own.
The danger in a sync is not conflicts — it is a **clean** merge that silently drops
a fork feature. `fork:verify` exists to make that a build failure.

## The one distinction that matters

`fork:verify` reports three things. Two are emergencies, one is routine:

| report | meaning | action |
|---|---|---|
| `✗ DROPPED owned files` | a fork-only file is **gone** | **stop.** re-apply before going further |
| `✗ LOST patch markers` | a fork edit to an upstream file was **reverted** | **stop.** re-apply |
| `✗ UNREGISTERED divergence` | a file differs from the baseline ref and isn't in the manifest | usually a stale baseline after a sync — see below |

Read the counts, not just the FAIL line:

```
owned files:   150/150 present     ← both intact means nothing was lost
patched files:  95/95 intact
divergence:     46 unregistered    ← this alone is almost always the baseline
```

A sync that reports 46 unregistered divergences with owned and patched both at
full count has **lost nothing**. Bump the baseline. A sync reporting even one
dropped owned file has lost a feature, however green everything else looks.

## Sync procedure

```bash
cd ~/dev/opencode-skein
git fetch upstream && git fetch origin
```

**1. Measure the delta from the merge-base, not from HEAD.**

```bash
MB=$(git merge-base HEAD upstream/dev)
git diff --name-only $MB..upstream/dev | wc -l          # what upstream changed
```

`git diff HEAD..upstream/dev` is the wrong command and will alarm you: it reports
every file that differs between the trees, which includes the fork's own ~270
commits. It said "245 fork-registered files touched" for a sync whose real answer
was **1**. Always diff from the merge-base.

**2. See how much of that lands on fork surfaces.**

```bash
python3 -c "
import json
m=json.load(open('fork/manifest.json'))
reg=set(m['owned'])|{p['file'] for p in m['patched']}
up=set(open('/tmp/up.txt').read().split())
print(len(reg&up),'fork-registered'); [print(' ',f) for f in sorted(reg&up)]
"
```

Few or none → expect a clean merge. Many → expect real reconciliation, and read
the previous sync commit first; it is the reasoning you are continuing.

**3. Merge, do not rebase.** A rebase replays the same conflict once per local
commit. With branches tens of commits apart that is dozens of resolutions of one
decision. `git merge upstream/dev --no-edit` takes it once.

**4. Verify before pushing.** In this order — `fork:verify` first, because a lost
feature can still typecheck:

```bash
bun install            # if bun.lock moved; regenerate, never hand-merge it
bun run fork:verify
bun typecheck
cd packages/opencode && bun test test/loop/
```

**5. Bump the baseline** once `fork:verify`'s only complaint is divergence.
`fork/manifest.json` → `baseline.upstreamRef` to the merged upstream commit,
`syncedAt`, and `forkTag`. The manifest says so itself: *"Bump it (and forkTag)
after every sync."* Re-run `fork:verify`; unregistered should drop to the
accepted count.

`bun run fork:verify --accept-divergence` re-baselines the accepted list
wholesale. Use it only when you have classified what it is about to swallow.

## Resolving conflicts on fork surfaces

The standing rule from the maintainer:

> we want our specific features but if upstream does the same thing and doesn't
> remove any of our functionality, let that win then. For all unsure cases, wait
> with them and present a list of them for me to decide in the end.

Upstream wins ties. The fork wins where it adds something upstream lacks.
Ambiguous hunks go on a list for the maintainer — never a guess.

**Check upstream before deciding what is fork-specific.** One command, and it has
been decisive:

```bash
git grep -n "<symbol>" upstream/dev -- packages/opencode/src/...
```

`McpTool` looked fork-specific from its name and its consumers. It is upstream's;
the fork had lost it in a merge, and 35 type errors were attributed to a migration
nobody was doing. The maintainer's suspicion was right and one grep settled it.

## Why this is enforced

Two features were lost in one merge before `fork:verify` ran automatically:

- **Self-healing compaction** — gone, with its only witness a test that had never
  been able to run.
- **The MCP exports** — gone, surfacing days later as type errors in unrelated
  files.

Both merged cleanly. Neither failed a build. `fork:verify` now runs in
`.husky/pre-push` and validates HEAD as well as the working tree, so this class
cannot reach `dev` silently.

Keep `fork/manifest.json` honest as part of the sync, not after it — a wrong
entry there is a hole in the only check that catches this.

## Working alongside another agent

Two rules learned expensively:

1. **Never commit a file you did not modify.** "Commit everything" means *your*
   work. Committing another agent's in-progress file made them redo it.
2. **Never change the tree while their suite runs** — `pgrep -f "test-shards|bun test"`.
   Stashing source mid-run corrupts a verification they are about to report.

To land a self-contained commit without touching a shared working tree:

```bash
git worktree add --detach /tmp/land origin/dev
git -C /tmp/land cherry-pick <sha>
git -C /tmp/land push origin HEAD:dev
git worktree remove /tmp/land --force && git worktree prune
```

## Related

`sync:check` (`bun run sync:check`) compares `upstream/dev` against
`baseline.upstreamRef` — use it to see whether a sync is due. The ecosystem-wide
design-first flow, codegen and deploy live in the **`skein-dev`** skill.
