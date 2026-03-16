---
name: gh-pr-compliance
description: Create or update GitHub pull requests so they comply with repository contribution rules before and after opening the PR. Use when Codex is about to run `gh pr create`, `gh pr edit`, `gh pr reopen`, or otherwise prepare a PR, especially in repositories that enforce CONTRIBUTING rules, PR templates, linked issues, title formats, or bot-driven compliance checks.
---

# Gh Pr Compliance

## Overview

Read the repository's PR requirements before opening or editing a pull request. Make the PR compliant on the first pass: title, linked issue, template sections, and follow-up verification after creation.

## Workflow

### 1. Read the repo rules first

Before creating or updating a PR, inspect the repo files that define contribution requirements.

- Check `CONTRIBUTING.md` for:
  - PR title rules
  - issue-first policy
  - body requirements
  - merge policy
- Check `.github/pull_request_template.md` and follow its section headings exactly.
- If the repo uses issue templates, inspect `.github/ISSUE_TEMPLATE/` before creating a linked issue.
- If the user already gave a target issue or PR, verify it still satisfies the current rules instead of assuming it does.

### 2. Create or confirm the linked issue

If the repo requires an existing issue, do not open the PR without one.

- Reuse an existing relevant issue if one exists.
- If none exists, create a small issue with the required template fields.
- Put `Fixes #123` or `Closes #123` in the PR body if the repo expects automatic linking.
- Keep the issue concise and factual. Do not paste a generic AI summary.

### 3. Prepare a compliant PR title

Convert the change into the repo's accepted title format.

- Use the allowed conventional prefixes from `CONTRIBUTING.md`.
- Add a scope only if the repo allows or expects it.
- Do not invent a prefix like `ci:` if the repo does not list it.
- If the work is configuration or maintenance, default to `chore:` unless the repo's rules clearly indicate another type.

### 4. Fill the PR template completely

When writing the PR body:

- Preserve the template's headings.
- Fill every required section with short, specific content.
- If a section is not applicable, say so explicitly instead of deleting it.
- Keep the explanation brief and concrete. Avoid long generic prose.
- Describe how the change was verified in a way a maintainer can trust.

### 5. Create or update the PR

Use `gh pr create`, `gh pr edit`, or `gh pr reopen` only after the title and body are already compliant.

- Prefer `--base` and `--head` explicitly.
- When updating an existing PR, fix the title and body in the same pass.
- If a bot closed the PR for compliance, repair the missing requirements first, then reopen it.

### 6. Verify the live PR after opening

After creating or editing the PR, inspect the live PR instead of assuming the request succeeded.

- Run `gh pr view` and confirm:
  - title is correct
  - linked issue is present
  - template sections are present
  - base and head branches are correct
- Check early bot comments and status checks for compliance failures.
- If a bot reports missing title/body/issue requirements, fix them immediately with `gh pr edit`.

## Default checklist

Use this checklist every time unless the repo proves a step is unnecessary.

- Read `CONTRIBUTING.md`
- Read `.github/pull_request_template.md`
- Read `.github/ISSUE_TEMPLATE/*` if the repo uses issue-first policy
- Create or locate a linked issue
- Build a valid PR title
- Fill every template section
- Open or edit the PR
- Verify the live PR with `gh pr view`
- Check bot comments and status checks for compliance errors

## Recovery

If the PR was already closed for non-compliance:

- inspect the closure comments
- fix every reported requirement
- update the title and body
- add or link the issue
- reopen the PR if appropriate, or create a new one if the repo policy or tooling requires it
