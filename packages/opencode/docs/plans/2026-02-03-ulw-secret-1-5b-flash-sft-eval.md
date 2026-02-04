# ULW: secret-1.5B flash (SFT) - logic + LLM evaluation plan

Date: 2026-02-03
Repo: packages/opencode

## Context

OpenCode is a Bun + TypeScript CLI/TUI that routes conversations through a unified LLM layer (AI SDK) and an agent/tooling layer.
Key integration points:

- Model/provider registry and SDK wiring: `src/provider/provider.ts`
- Prompt + streaming + tool-calling orchestration: `src/session/llm.ts`
- Provider configuration schema and merge behavior: `src/config/config.ts`

The ask is to evaluate a small/fast model variant ("secret-1.5B flash"), primarily SFT-tuned, focusing on:

1. agent/logic quality (tool use, workflow discipline, instruction adherence)
2. model quality (text generation, tool calling correctness, robustness)

## What "logic" means (model-facing)

In this context, "logic" is not the model weights themselves, but the OpenCode layers that shape how a model behaves:

- System prompt template selection and composition
- Agent prompt overrides (per agent)
- Provider/message normalization (provider quirks, tool-call ID normalization, unsupported modality handling)
- Tool availability gating and tool-call repair
- Provider request options (timeouts, max output tokens, headers)

### OpenCode logic map (where it lives)

- System prompt selection: `src/session/system.ts:18-25` (unknown models default to `src/session/prompt/qwen.txt`)
- Agent prompt override path: `src/session/llm.ts:70-80` (agent prompt beats provider prompt)
- Agent config field: `src/config/config.ts:628-660` (`agent.<name>.prompt`)
- Message normalization / provider quirks: `src/provider/transform.ts:43-168`
- Tool gating: `src/session/llm.ts:268-276`
- Tool-call repair (case mismatch -> lower): `src/session/llm.ts:189-209`
- LiteLLM/proxy compatibility (\_noop tool): `src/session/llm.ts:169-181`
- Provider request wrapper (timeout, OpenAI id stripping): `src/provider/provider.ts:999-1036`

## Goals

- Decide if `secret-1.5B flash` is viable as:
  - a primary model for certain agent modes, and/or
  - a small model (`small_model`) for low-stakes tasks (title, summarization, lightweight reasoning)
- Quantify tradeoffs vs baseline models: success rate, latency, cost, and failure modes
- Produce actionable signals for SFT iteration (what to add/remove from training or prompts)

## Non-goals

- Not a full scientific benchmark paper; focus on engineering signals that correlate with OpenCode UX.
- Not building a general-purpose LLM leaderboard; evaluation is scoped to OpenCode flows.

## Unknowns / assumptions (explicit)

- API compatibility is unknown. Default assumption: OpenAI-compatible Chat/Responses style endpoint, because OpenCode already supports `@ai-sdk/openai-compatible`.
- Tool calling support is assumed to exist (function calling / JSON tool calls).
- Target tasks are codebase editing and tool-driven workflows (Read/Grep/Glob/Bash/etc).

## What to evaluate (dimensions)

### A. Agent/logic behavior (system-level)

Measure whether the model behaves like a reliable OpenCode agent:

- Tool selection correctness (prefers Read/Grep/Glob over shell cat/grep/find)
- Minimal-question policy (asks only when truly blocked)
- Non-destructive git behavior (no reset --hard, no force push, no amend unless requested)
- Handles partial failures (tool errors, retries) without looping
- Output discipline (concise, structured, actionable)

### B. Tool calling quality (protocol-level)

- Tool call validity (schema-valid JSON, correct tool names, correct argument shapes)
- Repair behavior (e.g., case mismatch; see `experimental_repairToolCall` in `src/session/llm.ts`)
- Tool call efficiency (unnecessary calls, duplicated calls, over-fetching)

### C. Coding outcome quality (task-level)

- Patch correctness: does the produced change compile, typecheck, and pass tests?
- Minimal diff: avoids unrelated edits; respects repo conventions
- Regression risk: avoids fragile hacks and overfitting to the prompt

### D. Runtime characteristics

- Latency: TTFT (time to first token), time to first tool call, total wall time
- Token usage: input/output tokens; tool output bloat sensitivity
- Error rate: provider timeouts, malformed responses, rate limits

## Evaluation approaches (2-3 options)

### Option 1 (recommended): scenario runner + scored outcomes

Build a small harness that runs scripted scenarios through the real OpenCode stack and scores outcomes.

- Pros: highest fidelity, tests the actual tool loop and prompt stack
- Cons: requires sandboxing to avoid damaging local repos

### Option 2: trace replay (golden conversations)

Replay recorded real sessions (sanitized) and measure deltas.

- Pros: very realistic; good for SFT regression testing
- Cons: privacy + sanitization cost; deterministic replay can be hard

### Option 3: prompt-unit tests (microbench)

Small, fast checks for tool-call JSON, formatting, refusal policies.

- Pros: cheap and deterministic; catches regressions early
- Cons: weaker correlation to end-to-end success

Recommendation: start with Option 3 + a minimal Option 1 suite (10-30 scenarios). Add trace replay later.

## Concrete test suite proposal

Create 3 tiers so we can iterate quickly:

### Tier 0: protocol and policy (fast, deterministic)

- Tool-call schema tests (valid tool name + input JSON)
- Policy tests (refuse destructive git ops; no secret exfiltration)
- Style tests (response structure, minimal verbosity)

Scoring signals:

- invalid_tool_call_rate
- disallowed_action_rate
- formatting_compliance_rate

### Tier 1: tool-driven reasoning (medium)

Synthetic repo tasks that require:

- Grep to locate symbol
- Read to inspect file
- Edit/Patch to change a small function
- Optional Bash to run a single command

Scoring signals:

- task_success_rate (ground truth assertions)
- tool_error_rate
- tool_efficiency (calls/task)

### Tier 2: full workflow (slow, highest fidelity)

End-to-end flows:

- implement a small feature
- fix a failing test
- refactor a module while preserving behavior

Scoring signals:

- `bun run typecheck` pass/fail
- `bun test` pass/fail
- diff size and touched-file count

## Metrics and reporting

Report should include per-model and per-suite:

- Success: pass rate, test/typecheck rate
- Tooling: valid tool calls, tool errors, average tool calls per task
- Efficiency: median wall time, TTFT, tokens
- Cost (if available): estimated input/output cost using provider metadata
- Qualitative top failure modes with examples (1-2 per category)

## Harness design (how to implement in this repo)

### Runner shape

- A new script (e.g., `script/eval.ts`) or a CLI command (e.g., `src/cli/cmd/eval.ts`).
- Scenario format (JSON or JSONL):
  - `id`, `description`, `model` (provider/model), `messages` (user turns), `assertions`
  - optional `repoFixture` (git ref or fixture path)

### Isolation / safety

- Use a temporary git worktree for each scenario run.
- Disable network tools if the suite requires determinism.
- Apply strict timeouts (provider timeout already exists in config options).

### Instrumentation

- Capture all events:
  - prompts (system + user), tool schemas, tool calls, tool results, final response
  - timings (wall time per step)
- Prefer structured JSONL logs to enable diffing across runs.

### Where to hook

- LLM streaming entry: `src/session/llm.ts` (`LLM.stream`)
- Provider selection/model options: `src/provider/provider.ts`, `src/provider/transform.ts`
- Config-driven model selection: `src/config/config.ts` (`model`, `small_model`, and provider overrides)

## Integrating secret-1.5B flash into OpenCode (lowest-friction path)

If the model is served via an OpenAI-compatible endpoint, the simplest integration is a config-only provider:

- Add a `provider.secret` entry in `opencode.json` / `opencode.jsonc`
- Use `npm: "@ai-sdk/openai-compatible"`
- Set `api` and/or `options.baseURL`

Note: set at least `limit.context` and `limit.output` to avoid zero-default behavior.

## Model-specific preprocessing (based on `~/projects/llm/cselogic.md`)

`cselogic.md` describes an inference-time controller + prompt contract (NCMH/CSE) with a fixed reasoning loop and tool-schema expectations. To evaluate "the logic applied to the model" inside OpenCode, treat this as a prompt-and-protocol overlay.

### 1) Prompt overlay (most important)

Inject a thin overlay that forces the FSM and task-type behaviors:

- Global FSM: `Diagnose → Plan → Solve(iterative) → Verify → Reflect → Exit`
- Math: PoT + verification bias (prefer calculation/verification when uncertain)
- Coding: test-time patch loop with max retries (<=3) + explicit verify via tests
- Creative: `Diverge → Transform → Converge → Critique` with scoring-based selection

Practical OpenCode hook points:

- Preferred: set `agent.<name>.prompt` so the overlay is applied regardless of provider prompt (`src/session/llm.ts:70-80`, `src/config/config.ts:628-660`).
- Optional: add a dedicated provider prompt selector in `src/session/system.ts` if you want this auto-applied per model.

Tip: config supports `{file:/abs/path}` expansion, so you can inline an external prompt file without copying it into the repo (`src/config/config.ts:196+`).

### 2) Tool schema alignment

`cselogic.md` assumes tools like `calc.sympy`, `exec.python`, `search.web` and even shows a text tag format (`<tool name="...">{...}</tool>`). OpenCode exposes different tool names (`read`, `grep`, `glob`, `bash`, `webfetch`, ...).

For evaluation you have two viable paths:

- Use OpenCode tool names in the overlay prompt (recommended for E2E OpenCode eval).
- Add tool aliases (wrapper tools) so `calc.sympy` etc map to existing tools (requires code).

### 3) Protocol quirks (count these as part of "applied logic")

- Tool-call repair lowercases tool names on mismatch (`src/session/llm.ts:189-209`).
- Tool gating can remove tools based on agent/user permissions (`src/session/llm.ts:268-276`).
- Provider/message normalization may rewrite toolCallId formats for some providers (`src/provider/transform.ts:43-130`).

### 4) Benchmark the preprocessing itself (A/B)

Run A/B with and without the overlay:

- Tool-call validity rate
- FSM adherence + retry bounds
- Verify-before-claim behavior (typecheck/tests before saying "done")
- Failure taxonomy (math/code/facts) stability across seeds

## Risks and mitigations

- Nondeterminism: run multiple seeds (or multiple trials) and report variance.
- Privacy: do not log raw user repos; use fixtures and sanitize traces.
- Sandbox escapes: restrict tool permissions for eval runs.
- False positives: include at least one baseline model and a regression threshold.

## Next steps (practical)

1. Confirm the serving interface for `secret-1.5B flash` (OpenAI-compatible vs custom).
2. Pick baseline models (2-3) to compare against.
3. Implement Tier 0 microbench first, then 10 Tier 1 scenarios.
4. Start collecting failure modes and feed them back into SFT data and prompt tuning.
