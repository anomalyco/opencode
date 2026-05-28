---
description: Run a task through simplicio-cli with Simplicio1 (Qwen 2.5 Coder 3B) as the default provider
argument-hint: "<task description>"
---

Run the canonical SimplicioCode flow: map the project, then hand the task to `simplicio-cli` using **Simplicio1** (the local Qwen 2.5 Coder 3B served by Ollama) as the default model. Simplicio1 is free and has no token limit.

Steps:

1. Verify `ollama` is running and `qwen2.5-coder:3b` is pulled. If not, instruct: `ollama pull qwen2.5-coder:3b`.
2. Execute `script/simplicio/flow.sh "$ARGUMENTS"`.
3. The flow script enforces:
   - `SIMPLICIO_MODEL=ollama/qwen2.5-coder:3b`
   - `SIMPLICIO_BASE_URL=http://localhost:11434/v1`
4. Stream the simplicio-cli output back to the user and record the run in `docs/EVOLUTION.md` if the change touches tracked files.

If the user supplies `--remote` or names a different model in `$ARGUMENTS`, honor it; otherwise default to Simplicio1.
