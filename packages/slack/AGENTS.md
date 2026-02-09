# SLACK KNOWLEDGE BASE

## OVERVIEW

Slack integration package; runs Bolt app and bridges Slack threads to opencode sessions.

## WHERE TO LOOK

- Runtime entry: `packages/slack/src/index.ts`
- Package scripts/deps: `packages/slack/package.json`
- Setup/env docs: `packages/slack/README.md`

## CONVENTIONS

- Dev runner: `bun run src/index.ts`.
- Required envs: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.
- Uses `@opencode-ai/sdk` for backend communication.

## ANTI-PATTERNS

- Don’t commit Slack secrets or `.env` credentials.
- Don’t assume stateless messages; behavior is thread/session-oriented.
- Don’t replace SDK calls with ad-hoc API wiring.
