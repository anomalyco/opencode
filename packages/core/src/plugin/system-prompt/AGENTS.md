# System Prompts

Most prompts in this directory override the baseline prompt at `packages/core/src/session/runner/prompt/system.txt` (see `packages/core/src/plugin/optimize.ts`; `anthropic.txt` and `meta.txt` append to it).

When updating high-level harness instructions in `system.txt` or any override prompt here — such as `# Harness` rules, `<system-update>`, `<background-result>`, `${OPENCODE_TOOL_GUIDANCE}`, or `# Working in codebases` — update the other override prompts in this directory too so they stay consistent.
