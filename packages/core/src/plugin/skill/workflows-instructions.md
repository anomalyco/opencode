<!--
  Built-in skill. Name and description are registered in code at
  packages/opencode/src/skill/index.ts.
-->

# Workflow Instructions

Use this skill when the user asks to create, modify, run, debug, or review an
opencode workflow.

Do not route ordinary tasks through workflows by default. Workflows are for
repeatable multi-step automation, explicit user requests, or cases where the
user confirms that a workflow should own the execution.

## Authoring

Create reusable workflows as TypeScript files in `.opencode/workflows/`. The
file name becomes the workflow name used by the `workflow` tool with
`action: "start"`.

Prefer the typed helper. It exposes metadata for discovery and gives `args` the
types declared in `arguments`:

```ts
import { workflow } from "@opencode-ai/plugin"

export default workflow({
  name: "Example Workflow",
  description: "Describe when this workflow should be used.",
  phases: ["plan", "execute", "review"],
  arguments: {
    topic: {
      type: "string",
      description: "What to process.",
    },
  },

  async run(args, ctx) {
    ctx.setPhase("plan")
    ctx.log(`Planning work for ${args.topic}`)

    ctx.setPhase("execute")
    const result = await ctx.agent({
      agent: "general",
      prompt: `Do the work for: ${args.topic}`,
    })

    ctx.setPhase("review")
    return result
  },
})
```

Keep workflow descriptions concrete. The description is shown to agents in
`available_workflows`, so it should explain when to use the workflow and what
the workflow produces.

Workflow arguments support `string`, `number`, and `boolean` values. Provide
defaults when the workflow should be easy to run from autocomplete or by another
agent.

The `ctx` object available inside `run(args, ctx)` has these operations:

- `ctx.setPhase(name)` records the current phase and should be called before each major step.
- `ctx.log(message)` records progress in the workflow run logs.
- `ctx.agent({ agent, model, variant, tools, skills, files, schema, isolation, permissionSessionID })` starts one subagent session and returns `{ text, data }`.
- `ctx.parallel(tasks, options?)` runs async task functions concurrently and preserves result order. Returns `(T | null)[]` — a failing task drops to `null` at its position; **filter before use**.
- `ctx.pipeline(items, ...stages, options?)` runs each item through sequential async stages while processing items concurrently. Stages are **separate positional arguments** (not an array), with an optional trailing options object. Returns `(T | null)[]` — a stage that throws drops only that item to `null`; **filter before use**.
- `ctx.shell(command, { timeout?, cwd? })` runs a shell command in the run's workspace and returns `{ output, exitCode }`. No LLM turn, no budget cost; a non-zero exit is returned, not thrown.
- `ctx.workflow(name, args?)` runs another discovered workflow inline under the same run (depth 1 only). Shares this run's budget/concurrency/abort scope.
- `ctx.question({ question, options?, timeout? })` asks a human and waits for `{ answer }` (default 10-minute timeout, then the run parks as paused until answered).
- `ctx.budgetRemaining` is the live remaining USD budget (`Infinity` when no budget was set); read it to make a workflow budget-aware.
- `ctx.budget` is `{ total, spent(), remaining() }` (USD): `total` is the cap (`null` when unlimited), `spent()` the USD spent so far, `remaining()` the live remainder.

`ctx.agent(...)` details:

- `agent` is optional; omit it to use the default agent. Built-ins include `general`, `build`, `plan`, and `explore`. **Any configured agent can be dispatched by name** — for example a read-only docs/dependency-research `scout` agent if the project defines one. Use `action: "read"` or `action: "create"` on the workflow tool to see the live roster of dispatchable agents instead of guessing names.
- `model` is optional. Use `provider/model` for a specific model, or the keyword `"small"` to route to the configured `small_model` (cheap/fast steps; fails if `small_model` is not configured).
- `variant` is an optional reasoning variant (e.g. `"max"`) threaded into the model run; compose it with `model`.
- `tools` is an optional `Record<string, boolean>` (glob-able keys) scoping which tools/MCP/skills the step's subagent can use, e.g. `{ webfetch: false }` or `{ "skill_*": true }`.
- `skills` is an optional `string[]` of skills to make available to the step; the agent loads them before working.
- `files` is an optional `string[]` of file paths to attach (resolved against the workspace, must exist) so the agent can read them directly.
- `isolation: "worktree"` runs the step in a fresh git worktree so parallel file-mutating agents do not conflict (requires a git repo).
- `schema` is an optional JSON Schema. When provided, structured output is **mandatory**: if the model returns no result matching the schema, the step **fails** with a structured-output error (no fallback to prose). Catch it in `run()` if you want to handle that gracefully.
- `data` is the parsed structured object when schema output is available; otherwise it is the assistant text.
- `text` is the human-readable assistant output. For structured output it is the formatted JSON.
- `permissionSessionID` only redirects WHERE interactive permission prompts surface; it does NOT grant or scope permissions. Subagents already inherit the caller session/agent's deny and external-directory rules automatically, so you rarely set this.

### Fan-out limits and budget

- `ctx.parallel` defaults to **20** concurrent tasks when `concurrencyLimit` is omitted; `ctx.pipeline` defaults to **unbounded** item concurrency. Set `concurrencyLimit` explicitly for large or rate-sensitive fan-outs.
- On top of any per-call limit, every run is bounded run-wide to between **2 and 16** simultaneous agent steps (based on host CPUs) — the narrower of the run-wide cap and your `concurrencyLimit` always wins, so `concurrencyLimit: 50` is still capped at ≤16.
- A single run may start at most **1,000** total agent dispatches (including journal replays); exceeding that fails the step with an agent-limit error. Keep fan-outs bounded (cap list lengths).
- `budget` (a `start` argument, USD) caps total run cost. It is a **soft, per-step** cap: it is checked before each `ctx.agent` step and settled after, so concurrent in-flight steps can overspend by their combined cost. Once the cap is reached the next step fails with a budget error.

## Authoring Patterns

### Structured Output

Use JSON Schema when a later step needs reliable fields instead of prose. Keep
schemas small, set `additionalProperties: false`, and tell the agent to return
data matching the schema exactly.

When you pass `schema`, a structured result is **mandatory**: if the model
produces no result matching the schema, the agent step **fails** with a
structured-output error (it does not fall back to prose), and the run fails unless
`run()` catches it. `data` is the parsed object only on success.

```ts
const briefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risks"],
  properties: {
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
  },
}

const brief = await ctx.agent({
  agent: "plan",
  schema: briefSchema,
  prompt: [`Feature: ${args.feature}`, "Return only data that matches the provided JSON schema."].join("\n"),
})

return { brief: brief.data }
```

### Sequential Agents

Pass earlier outputs explicitly into later prompts. Prefer `data` for structured
steps and `text` for prose summaries.

```ts
ctx.setPhase("plan")
const plan = await ctx.agent({ agent: "plan", prompt: `Plan work for ${args.topic}` })

ctx.setPhase("review")
const review = await ctx.agent({
  agent: "general",
  prompt: ["Review this plan for risks and missing checks.", "", plan.text].join("\n"),
})
```

### Parallel Fan-Out

Use `ctx.parallel` when independent agents can work from the same input. Add a
`concurrencyLimit` for dynamic or large fan-outs. The result is `(T | null)[]`: a
failing task drops to `null` instead of failing the batch, so filter before use.

```ts
ctx.setPhase("parallel-review")
const findings = (
  await ctx.parallel([
    () => ctx.agent({ agent: "plan", prompt: `Find risks in: ${brief.text}` }),
    () => ctx.agent({ agent: "build", prompt: `Suggest implementation steps for: ${brief.text}` }),
  ])
).filter((finding) => finding !== null)

return { findings: findings.map((finding) => finding.text) }
```

### Dynamic Agent Counts

An agent can first produce a structured list, then the workflow can fan out over
that list. Build the task array from `data` and cap concurrency.

```ts
const topics = await ctx.agent({
  agent: "plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: { items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 } },
  },
  prompt: `Break this request into review topics: ${args.topic}`,
})

const items = (topics.data as { items?: string[] }).items ?? []
const reviews = (
  await ctx.parallel(
    items.map((item) => () => ctx.agent({ agent: "general", prompt: `Review this topic: ${item}` })),
    { concurrencyLimit: 3 },
  )
).filter((review) => review !== null)
```

### Pipelines

Use `ctx.pipeline` when every item should pass through the same ordered stages.
Each item runs stage 1, then stage 2, and so on; different items can progress
concurrently. Pass each stage as a **separate positional argument** (not an
array), with an optional trailing `{ concurrencyLimit }`. Each stage receives two
arguments — `(prev, item)` — the previous stage's output for this item AND the
original item, so a later stage can still reach the value it started from.

```ts
const outputs = (
  await ctx.pipeline(
    ["api", "ui", "tests"],
    async (area) => (await ctx.agent({ agent: "explore", prompt: `Inspect ${area}` })).text,
    async (notes, area) =>
      (await ctx.agent({ agent: "plan", prompt: `Turn notes for ${area} into checks:\n${notes}` })).text,
    { concurrencyLimit: 4 }, // optional, trailing
  )
).filter((out) => out !== null) // a stage that throws drops that item to null
```

Passing the stages as a single array would be a silent no-op: a JS array is an
object, so it is consumed as the trailing options argument, leaving zero stages —
the pipeline returns the input items unchanged. Always pass stages as separate
arguments.

### Intermediate Results

Workflows can return any JSON-serializable object. Include intermediate outputs
that the user or later inspection will need, not only the final summary. The
return value is round-tripped through JSON before it is stored, so functions,
symbols, and class instances are silently dropped — return plain data.

```ts
return {
  topic,
  brief: brief.data,
  reviews: reviews.map((item) => item.text),
  summary: summary.text,
}
```

## Quality Patterns

These orchestration patterns raise output quality and use only the primitives
above. Copy and adapt them.

### Judge panel

Run several independent reviewers in parallel, then have one judge synthesize a
verdict from their (null-filtered) opinions.

```ts
ctx.setPhase("panel")
const opinions = (
  await ctx.parallel([
    () => ctx.agent({ agent: "plan", prompt: `Critique correctness:\n${draft.text}` }),
    () => ctx.agent({ agent: "general", prompt: `Critique completeness:\n${draft.text}` }),
    () => ctx.agent({ agent: "build", prompt: `Critique maintainability:\n${draft.text}` }),
  ])
).filter((opinion) => opinion !== null)

ctx.setPhase("judge")
const verdict = await ctx.agent({
  agent: "plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["accept", "issues"],
    properties: {
      accept: { type: "boolean" },
      issues: { type: "array", items: { type: "string" } },
    },
  },
  prompt: ["Synthesize one verdict from these reviews.", ...opinions.map((o) => o.text)].join("\n\n"),
})
```

### Loop until dry

Iterate a revise → review cycle until a critic finds nothing material (or a hard
iteration cap is hit, so the loop always terminates).

```ts
let work = draft.text
for (let pass = 0; pass < 4; pass++) {
  ctx.setPhase("critic")
  const critic = await ctx.agent({
    agent: "plan",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["done", "fixes"],
      properties: { done: { type: "boolean" }, fixes: { type: "array", items: { type: "string" } } },
    },
    prompt: `List remaining material issues, or set done=true:\n${work}`,
  })
  const { done, fixes } = critic.data as { done: boolean; fixes: string[] }
  if (done || fixes.length === 0) break

  ctx.setPhase("revise")
  work = (await ctx.agent({ agent: "build", prompt: `Apply these fixes:\n${fixes.join("\n")}\n\nTo:\n${work}` })).text
}
```

### Completeness critic

Before returning, have a dedicated critic check the result against the original
request and gate on its verdict.

```ts
const check = await ctx.agent({
  agent: "plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["complete", "missing"],
    properties: { complete: { type: "boolean" }, missing: { type: "array", items: { type: "string" } } },
  },
  prompt: [`Original request: ${args.topic}`, `Does this fully satisfy it?`, work].join("\n\n"),
})
if (!(check.data as { complete: boolean }).complete) {
  ctx.log("Completeness critic flagged gaps; running one more revision pass")
}
```

### Budget-aware loop

Stop iterating when the run is running low on budget instead of failing on the
budget error mid-loop.

```ts
while (ctx.budget.remaining() > 0.5) {
  const next = await ctx.agent({ agent: "build", prompt: "Improve the weakest section." })
  work = next.text
  if (/no further improvements/i.test(work)) break
}
ctx.log(`Stopped after spending $${ctx.budget.spent().toFixed(2)}`)
```

### Human gates and deterministic checks

Use `ctx.question` for a human decision point and `ctx.shell` for deterministic
verification (builds, tests) that should not cost an LLM turn.

```ts
const build = await ctx.shell("bun run build && bun test")
if (build.exitCode !== 0) {
  const { answer } = await ctx.question({
    question: `The build/test step failed:\n\n${build.output.slice(-2000)}\n\nHow should I proceed?`,
    options: ["fix it", "ignore and continue", "abort"],
  })
  if (answer === "abort") return { aborted: true, output: build.output }
}
```

## Authoring Guidelines

- Keep workflows deterministic in structure: agents may produce content, but the workflow should own phase transitions, branching, fan-out limits, and final result shape.
- Prefer a small structured planning step before dynamic branching instead of asking many agents to infer their own scope.
- Log before expensive or long-running steps so `inspect` shows where the run is.
- Keep prompts specific to the step and include only the prior outputs needed for that step.
- Use schemas for machine-readable handoffs; use prose for final user-facing summaries.
- Avoid writing files from a workflow unless the workflow's purpose is explicitly to produce files.
- Return useful data from `run`; do not rely only on logs or agent session history.

## Running

Use the `workflow` tool with `action: "read"` before starting a workflow if the
arguments, phases, or purpose are unclear.

Use the `workflow` tool with `action: "start"` for existing workflows. It asks
for workflow permission, so the user can approve once or allow the workflow
always. Optional `start` arguments:

- `budget` — a USD cost cap for the whole run (soft, per-step; omit for unlimited).
- `background: true` — start asynchronously and get a completion message later.
- `resume_of` / `invalidate_agents` — resume a previous paused/interrupted run
  from its journal, optionally forcing some agent indices back to a live re-run.

Use foreground mode when the result is needed before continuing. Use
`background: true` when the workflow can run asynchronously; the session will
receive a synthetic completion message when it finishes.

Use the `workflow` tool with `action: "wait"` only when you already have a run
id and need to wait for a running workflow to finish.

Use the `workflow` tool with `action: "create"` to write a persistent
`.opencode/workflows/<name>.ts` file (this is the first-class way to author one —
it gates on the `workflow` + `edit` permissions, statically validates the meta,
and reports the parsed metadata). Pass `name` (file basename, `^[A-Za-z0-9_-]+$`)
and `source` (complete TypeScript), plus `overwrite: true` to replace an existing
file.

## Reviewing Executions

Use the `workflow` tool with `action: "inspect"` to review history and
execution details.

Recommended flow:

1. Use `action: "inspect"` with `view: "summary"` to check status and result.
2. Use `view: "logs"` to read phase logs.
3. Use `view: "result"` to read just the run's final result alongside its summary,
   without the full logs/agents dump.
4. Use `view: "agents"` to list subagent runs and ids.
5. Use `view: "agent"` with `agent_id` to read a specific subagent prompt,
   final response, usage, and errors.
6. Use `view: "all"` only when the user needs a complete audit trail (it also
   includes the workflow source).
