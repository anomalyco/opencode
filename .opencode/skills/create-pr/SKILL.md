---
name: create-pr
description: Create clean pull requests with proper branching, commits, and descriptions
license: Apache-2.0
compatibility: opencode
---

# create-pr

Create pull requests with clean history and thorough descriptions.

## Workflow

### 1. Confirm the target base branch

Usually `main` or `dev`. Ask the user if unsure.

### 2. Create a clean branch

```bash
git checkout <base> && git pull origin <base> && git checkout -b <branch-name>
```

Branch naming conventions:
- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — dependencies, tooling, maintenance
- `refactor/` — code restructuring
- `docs/` — documentation

Always branch from the target base, never from a feature or work branch.

### 3. Stage and commit

One logical commit per change. Use conventional commits:

```
type(scope): description
```

Examples:
- `feat(api): add user authentication endpoint`
- `fix(parser): handle null input gracefully`
- `chore(deps): update lodash to 4.17.21`

Squash multiple WIP commits before pushing:
```bash
git rebase -i HEAD~N
```

Only commit what was asked. Exclude unrelated local files (config, editor temp files, etc.).

### 4. Push

```bash
git push -u origin HEAD
```

### 5. Create the pull request

Use the GitHub CLI:

```bash
gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"
```

Never use em dashes (-- or —) in the body - they are a strong signal of AI-generated text and will get the PR ignored.

Check if the repo has a PR template at `.github/pull_request_template.md`. If it does, use that format for the body.

If no template exists, use this fallback:

```
## Summary

<brief description of what changed and why>

## Changes

- <file>: <specific change>
- <file>: <specific change>

## Checklist

- [ ] Compiles successfully
- [ ] No new warnings
- [ ] Tests pass
```

### 6. Verify

- Confirm the PR URL is returned to the user.
- The PR should contain exactly the commits needed — no extra history from the base branch.
