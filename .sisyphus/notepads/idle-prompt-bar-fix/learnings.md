# Learnings

- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` already calls `renderer.requestRender()` inside the idle-cycle interval (line ~138) while guarding on idle/empty/animations/visibility.
- `check-sandbox-evidence.sh` now prefers model/provider text from the sandbox model (passed via `--model`) when selecting the prompt bar line, before falling back to `GPT-5.2|OpenAI|Build|Ask anything`.
- `run-sandbox-tui.sh` and `scripts/compare-tui-baseline.sh` pass `--model` through to evidence checks/harness runs.
- `--use-real-auth` allows idle harness to run without API key; idle harness reports "Evidence OK" with `openai/gpt-5.2-codex`.
- Baseline compare still reports upstream model invalid for `openai/gpt-5.2-codex`, but continues and prints diffs.
