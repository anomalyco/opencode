# Code Mode agents

Inside `execute`, two globals let one script run many model calls:

| Global                    | What it does                                                                     | Cost                |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| `agent(prompt, options?)` | Starts a subagent in its own child session, with tools, and waits for its result | A full subagent run |
| `llm(prompt, options?)`   | One model call: no tools, no conversation history                                | One request         |

Start agents only when the user asked for parallel agents, multi-agent work or a workflow. For anything else, describe what a script would do and roughly how many agents it would start, and ask. `llm()` is cheap enough to use whenever a script needs a model.

## agent()

```js
const text = await agent("Summarize how auth works in src/auth. Cite files.")
const review = await agent(`Review ${file} for bugs`, { schema: Findings, label: `review ${file}` })
```

Options (anything else is an error):

- `schema`: return a value checked against this schema instead of text. See Schemas.
- `agent`: the subagent type, default `"general"`. Use `"explore"` for read-only research.
- `model`: `"providerID/modelID"`. Omit it to use the agent's or the session's model.
- `effort`: `"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`. Use `"low"` for fast mechanical workers; omit to inherit.
- `label`: a short title for the child session and the progress row.
- `retries`: 0 to 3 extra attempts after a failure that is not a usage or rate limit. Default 0.

The child starts with no context: put everything it needs in the prompt (paths, what to look for, what to return). It gets the project's instructions files itself. Its result goes to your script, not to a person, so ask for data, not prose.

Each child is a normal session the user can open. agent() rejects when the child fails, and stopping the script stops its children.

## llm()

```js
const label = await llm(`Is this a bug report or a feature request?\n\n${issue.body}`, {
  schema: {
    type: "object",
    properties: {
      kind: { enum: ["bug", "feature"] },
      confidence: { type: "number" },
    },
    required: ["kind", "confidence"],
    additionalProperties: false,
  },
})
```

Options: `schema`, `system`, `model`, `effort`, `label`, `retries`. Defaults to low reasoning effort when the model supports it; pass `effort: "high"` for harder steps. It sees only `system` and `prompt`, so include the text it should work on. Use it to classify, extract, summarize, deduplicate or judge text the script already has. If the step needs to read files or run commands, use agent().

## Schemas

With `schema`, the model must return a value that matches; agent() and llm() check it and give the model the exact problems to fix until it does, so the script gets a value it can use without parsing.

```js
const Findings = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer", minimum: 1 },
          severity: { enum: ["low", "medium", "high"] },
          summary: { type: "string", description: "One sentence" },
        },
        required: ["file", "severity", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
}
```

- Pass standard JSON Schema (Draft 2020-12).
- `pattern` is shown to the model as guidance but is not enforced during validation; check regexes in the script if they matter.
- A root that is not an object works: `{ type: "array", items: { type: "string" } }` returns an array directly.

Describe fields whose meaning is not obvious from the name: the model reads the descriptions.

## Running calls together

Calls run concurrently when you start them before awaiting:

```js
const results = await Promise.all(files.map((file) => agent(`Review ${file}`, { schema: Findings })))
```

- At most 16 agents and 32 `llm()` calls run at once; the rest wait their turn. A script may start 100 agents and 500 `llm()` calls in total.
- `Promise.all` rejects on the first failure. Use `Promise.allSettled` when some may fail and the rest are still useful.
- After any call hits a usage or rate limit, no more calls start: they would fail the same way.

Chain each item's steps inside one async function, so an item moves on as soon as its own step finishes instead of waiting for the slowest item:

```js
const verified = await Promise.all(
  files.map(async (file) => {
    const review = await agent(`Review ${file} for bugs`, { schema: Findings })
    return Promise.all(
      review.findings.map(async (finding) => ({
        ...finding,
        verdict: await agent(
          `Try to disprove this finding. Default to real: false if unsure.\n${JSON.stringify(finding)}`,
          {
            schema: Verdict,
          },
        ),
      })),
    )
  }),
)
```

Wait for every result first only when the next step needs all of them, such as deduplicating across all findings or stopping early when there are none.

## Patterns

- **Fan out, then verify.** Finders return candidates; independent agents try to disprove each one; keep what survives. Verifiers that try to refute catch more than ones that confirm.
- **Different lenses.** For one claim, ask a few agents to check it from different angles (correctness, security, does it reproduce) and take the majority.
- **Several attempts, then judge.** Have a few agents solve the same problem different ways, then score them with llm() or an agent and keep the best.
- **Loop until nothing new.** Repeat a finding round until two rounds in a row find nothing you haven't seen. Deduplicate against everything seen, including rejected items, or the loop never ends.
- **Cheap steps with llm().** Use llm() to triage, deduplicate or merge agent results instead of another agent.

## Rules of thumb

- Put scouting, per-item pipelining, and writing final files (`Bun.write`) in one `execute` call instead of bouncing intermediate results back to the main session between turns.
- Keep each agent's task small and specific, with a clear result. One agent per file or per finding beats one agent for everything.
- Agents that edit files at the same time can overwrite each other. Give them separate files, or have them return changes and apply them yourself.
- Return the summary the user needs from the script, not every raw result: the script's return value is what you read next.
- Scripts are JavaScript, not TypeScript, and have no timers. `console.log` lines come back with the result.
