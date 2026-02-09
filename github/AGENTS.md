# GITHUB ACTION KNOWLEDGE BASE

## OVERVIEW

GitHub Action runtime that handles `/oc` and `/opencode` comment workflows.

## WHERE TO LOOK

- Action runtime entry: `github/index.ts`
- Package manifest: `github/package.json`
- Usage and local mock flow: `github/README.md`
- Action metadata: `github/action.yml`

## CONVENTIONS

- Module entry is `index.ts` (`type: module`).
- Depends on `@actions/*`, Octokit, and `@opencode-ai/sdk`.
- Local testing uses mock env vars (`MOCK_EVENT`, `MOCK_TOKEN`, `GITHUB_RUN_ID`, model/api keys).

## ANTI-PATTERNS

- Don’t hardcode provider secrets/tokens.
- Don’t change event parsing without checking issue + review-comment paths.
- Don’t diverge from documented local mock workflow when debugging action logic.
