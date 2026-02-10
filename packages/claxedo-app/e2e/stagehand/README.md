# Stagehand E2E (Claxedo App)

This folder contains Stagehand-driven browser checks for terminal rendering regressions.

## Setup

1. Install dependencies:

```bash
cd /Users/yashvardhansingh/test/opencode/packages/claxedo-app
bun install
```

2. Start the app:

```bash
cd /Users/yashvardhansingh/test/opencode/packages/claxedo-app
bun run dev
```

3. Provide model credentials and target URL:

```bash
export OPENAI_API_KEY=...
export STAGEHAND_BASE_URL=http://127.0.0.1:3000
```

Optional:

```bash
export STAGEHAND_MODEL=openai/gpt-4.1-mini
```

## Run red check

```bash
cd /Users/yashvardhansingh/test/opencode/packages/claxedo-app
bun run test:stagehand:red
```

The script runs an AI-guided flow and then asserts terminal renderer health
without requiring manual window resize.
