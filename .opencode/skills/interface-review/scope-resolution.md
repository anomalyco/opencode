# Scope resolution

Turning a review target into a file list. The commands themselves are ordinary git. What follows is the part that is not obvious, plus the traps that fail quietly and leave the scope block claiming a count it never delivered.

## Default branch

Try `refs/remotes/origin/HEAD`, then `gh repo view --json defaultBranchRef`, then `init.defaultBranch`. If the ref is missing, ask the remote with `git remote set-head origin --auto` rather than guessing. It needs the network and writes a ref under `.git`, leaving the working tree untouched, so it is permitted; note it in Verification. With no remote at all, fall back to a local `main` or `master` and state which base you assumed.

## Targets

Accepted targets are `working`, `staged`, `branch`, `pr <n>`, a bare `<ref>` and an explicit `<a>..<b>` or `<a>...<b>` range. Anything else in the invocation is a `<ref>`.

Diff a branch against the **merge base**, three dots. Two dots reports every upstream commit that landed on the base branch as part of the change.

But use the dots the user wrote when they wrote a range. `<a>..<b>` compares the endpoints; `<a>...<b>` compares `merge-base(<a>, <b>)` with `<b>`. Rewriting `release..feature` to three dots drops everything between `release` and the merge base, which is often exactly what was asked for. State the resolved range in the scope block.

`git diff HEAD` reports tracked changes only. Any target including uncommitted work must pair it with `git ls-files --others --exclude-standard`. Otherwise a newly added component is silently dropped from a scope the report claims to cover in full. For `branch` with uncommitted work, report the two counts separately.

## Pull requests

Fetch the head into a remote-tracking ref, `git fetch origin "pull/<n>/head:refs/remotes/pr/<n>"`, and review it in place. This works for forks, which `origin/<branch>` does not.

Read files at that ref with `git show refs/remotes/pr/<n>:path/to/file`. Never open the working-tree copy; on a fork PR it is a different file.

`gh pr diff <n>` is a fine shortcut for the patch text. It gives no way to read unchanged context or expand to consumers, so fetch the ref as well.

**Citations.** `better-interface` requires `path/to/file:line`, and line numbers from a fetched ref need not match the working tree. Cite against the head ref, and declare that ref and its SHA in the scope block so the numbers resolve.

**Intent.** The `title` and `body` from `gh pr view` are the stated intent for **Hold the change to its stated intent**. Add the commit subjects when the body is empty.

## Awkward repository states

Three worth handling. Everything else fails loudly at `merge-base`: no remote, unrelated histories, a repo with no commits, a moved submodule pointer. Say the base is unresolvable and stop. Never review a range you cannot name.

**Detached HEAD.** Use the merge base against the default branch and name the SHA, not a branch, in the scope block.

**Shallow clone**, the CI default, where `merge-base` returns nothing. Fetch `--deepen=50`, retry, then `--deepen=200`, then report the scope as unresolvable. Deepening writes to `.git` and not to the working tree, so it is permitted; note it in Verification.

**Mid-rebase or mid-merge**, the one that does not fail loudly. `git diff` succeeds and returns something that is not the change, so the review looks fine and is wrong. Detect it with `git rev-parse --git-path` against `rebase-merge`, `rebase-apply`, `MERGE_HEAD` and `CHERRY_PICK_HEAD`. Do not test `.git/` paths directly, because they are not directories inside a linked worktree. Stop and say the tree is mid-operation.

## Nothing to review

The tree is clean and `HEAD` is not ahead of the merge base. Gather the facts before asking, so the offer is accurate rather than a guess: the current branch, whether the tree is clean, the count ahead of the base, the last commit's SHA and subject and any open pull request from `gh pr status`.

`gh pr status` succeeds when no pull request is open. It omits `currentBranch`, so an empty result is an answer, not an error. It fails outright without `gh`, without authentication and on a repository with no GitHub remote. Treat any failure as "no pull request found", say so and offer the remaining routes rather than stopping.

Report those facts, then offer the three routes in **With no change, ask rather than invent one**. State the last commit's SHA and subject inside the offer. The user recognises "a1b2c3d Merge pull request #482" as not what they wanted and cannot recognise "the last commit".

A whole-repository audit is a different review, not this one with a wider net. Hand the repository to `better-interface` directly, without a scope block, statuses, or a pre-existing section.

## Renames

Rename detection is on by default for `--name-status`, reporting `R100 old/path new/path`. Raise the window with `--find-renames=40% --find-copies-harder` when a file was moved and edited in the same change.

Review a rename as a move, not a delete plus an add. Everything that survived the move is unchanged code, and only the genuine edits are in scope.

## Excluded paths

Exclude these and name what you excluded in the scope block. They are machine-authored and carry no interface rules.

| Category | Patterns |
| --- | --- |
| Lockfiles | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `poetry.lock`, `uv.lock` |
| Snapshots and fixtures | `__snapshots__/`, `*.snap`, `*.approved.*`, `test-results/`, `playwright-report/` |
| Generated output | `dist/`, `build/`, `out/`, `.next/`, `.turbo/`, `.svelte-kit/`, `coverage/`, `storybook-static/`, `*.min.js`, `*.min.css`, `*.map` |
| Generated sources | `*.gen.ts`, `*.generated.*`, `*.d.ts` emitted by a build, GraphQL and Prisma client output |
| Vendored code | `vendor/`, `third_party/`, `node_modules/` |
| Binaries and media | `*.png`, `*.jpg`, `*.webp`, `*.avif`, `*.woff2`, `*.mp4`, `*.pdf` |

Two exceptions stay in scope. A **font file** added or swapped is a `better-typography` change. An **image** added to a component is a `better-ui` and `better-accessibility` change, through its `alt` text and its outline. Review the code that references them, not the bytes.

Apply the exclusions as pathspecs so the file count in the scope block is the reviewed count. Two traps under-exclude silently. `*.lock` catches `yarn.lock` and `Cargo.lock` but not `package-lock.json` or `pnpm-lock.yaml`, so cover every suffix in the table. And `**` needs `glob` magic: without it `*` never crosses `/`, so `**/dist/**` excludes `packages/a/dist/` but misses a root-level `dist/`. Run the diff with and without the pathspecs and confirm the count dropped by exactly the files you named.

## Expanding to consumers

**A diff is not a surface** expands one hop, two for tokens and primitives. Use the project's own resolver where one exists, otherwise import paths.

`git grep` searches the working tree by default. Pass the reviewed ref after the pattern, or on a pull request you search a different revision and miss importers the change itself added. Results come back as `<rev>:path/to/file`; read them with `git show`, never the working-tree copy. Pass `-e` when the pattern starts with a dash, such as a `--color-*` token, or git parses it as an option.

For a changed token or theme value, search the token name rather than the file, since consumers reference the name and never import it.

Order the consumers by a rule you can evaluate, so the cutoff is reproducible instead of a guess:

1. **Route and layout entry points first**, whatever the framework treats as a rendered surface: `app/**/page.*`, `app/**/layout.*`, `pages/**`, `routes/**`, `src/views/**`, `*.astro` pages. Everything else only appears inside one.
2. **Then by importer count**, since a component pulled in by twenty files carries more of the change than one pulled in by two.
3. **Break ties by proximity**, same package or feature directory first.

Review the first five, state how many you did not expand and say plainly if the ordering was arbitrary past a point.
