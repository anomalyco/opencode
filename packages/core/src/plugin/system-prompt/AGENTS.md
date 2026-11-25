# System Prompts

Most prompts in this directory override the baseline prompt at `packages/core/src/session/runner/prompt/system.txt` (see `packages/core/src/plugin/optimize.ts`; currently only `anthropic.txt` appends to it).

When updating high-level harness instructions in `system.txt` or any override prompt here — such as `# Harness` rules, `<system-update>`, `<background-result>`, `${OPENCODE_TOOL_GUIDANCE}`, or `# Working in codebases` — update the other override prompts in this directory too so they stay consistent.

## OpenAI Prompts

OpenAI prompts (`gpt.txt`, `gpt-astra.txt`, `gpt-6.2.txt`) are typically derived from Codex's model prompts. For GPT-6.2, Codex uses the same core instructions for both Sol and Astra, so `gpt-6.2.txt` is intentionally unified for both models rather than split into a separate Astra file.
