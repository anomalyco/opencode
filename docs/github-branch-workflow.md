# GitHub Branch Workflow

## Current Policy

- Use `dev` as the primary development branch.
- Do not merge work into `main` for now.
- Open all new PRs against `dev`.
- Create all work branches from `dev`.
- Revisit the role of `main` only at a release milestone.

## Why

`main` and `dev` currently have unrelated histories. Treating `dev` as the main line avoids risky history reconciliation during normal feature delivery.

## 5-Step Workflow

1. Set `dev` as the active development baseline.
2. Change the GitHub default branch to `dev` if repository settings allow it.
3. Create new branches from `dev` using names like `feat/...`, `fix/...`, or `docs/...`.
4. Open pull requests with `dev` as the base branch.
5. Keep `main` frozen until a future release decision defines whether to recreate it from `dev`, retire it, or formalize `dev` as the long-term default branch.

## Practical Rule

- Development: `dev`
- PR base: `dev`
- `main`: hold
