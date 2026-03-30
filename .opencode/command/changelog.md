---
model: opencode/kimi-k2.5
---

Create `UPCOMING_CHANGELOG.md` from the structured changelog input below.
If `UPCOMING_CHANGELOG.md` already exists, ignore its current contents completely.
Do not preserve, merge, or reuse text from the existing file.

Any command arguments are passed directly to `bun script/changelog.ts`.
Use `--from` / `-f` and `--to` / `-t` to preview a specific release range.

The input already contains the exact commit range since the last non-draft release.
The commits are already filtered to the release-relevant packages and grouped into
the release sections. Do not fetch GitHub releases, PRs, or build your own commit list.
The input may also include a `## Community Contributors Input` section.

Before writing any entry you keep, inspect the real diff with
`git show --stat --format='' <hash>` or `git show --format='' <hash>` so the
summary reflects the actual user-facing change and not just the commit message.
Do not use `git log` or author metadata when deciding attribution.

Rules:

- Write the final file with sections in this order:
  `## Core`, `## TUI`, `## Desktop`, `## SDK`, `## Extensions`
- Only include sections that have at least one notable entry
- Keep one bullet per commit you keep
- Skip commits that are entirely internal, CI, tests, refactors, or otherwise not user-facing
- Start each bullet with a capital letter
- Prefer what changed for users over what code changed internally
- Do not copy raw commit prefixes like `fix:` or `feat:` or trailing PR numbers like `(#123)`
- Community attribution is deterministic: only preserve an existing `(@username)` suffix from the changelog input
- If an input bullet has no `(@username)` suffix, do not add one
- Never add a new `(@username)` suffix from `git show`, commit authors, names, or email addresses
- If no notable entries remain and there is no contributor block, write exactly `No notable changes.`
- If no notable entries remain but there is a contributor block, omit all release sections and return only the contributor block
- If the input contains `## Community Contributors Input`, append the block below that heading to the end of the final file verbatim
- Do not add, remove, rewrite, or reorder contributor names or commit titles in that block
- Do not derive the thank-you section from the main summary bullets
- Do not include the heading `## Community Contributors Input` in the final file

## Changelog Input

!`bun script/changelog.ts $ARGUMENTS`
