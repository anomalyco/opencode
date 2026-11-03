import { test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

const model = (id: string, name: string, input: number) => ({
  id,
  modelID: id,
  providerID: "opencode",
  name,
  status: "active",
  enabled: true,
  cost: [{ input, output: input * 5, cache: { read: 0, write: 0 } }],
  capabilities: { input: ["text"], output: ["text"], reasoning: false, toolCall: true, attachment: false },
  limit: { context: 1_000_000, output: 64_000 },
  variants: [],
  time: { released: 1 },
})

test("shows what the workspace's limits leave and why a refused turn stopped", async () => {
  await using state = await tmpdir()
  const session = {
    id: "ses_usage_limits",
    projectID: "proj_test",
    location: { directory },
    title: "Usage limits",
    agent: "build",
    model: { providerID: "opencode", id: "gpt-5.6-sol" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  const resetsAt = "2026-11-01T00:00:00.000Z"
  // One request that fills Sol's context costs $4, so the $6 left won't cover three.
  const limits = {
    workspace: { id: "wrk_1", name: "Acme", usageURL: "https://opencode.ai/wrk_1/activity/overview" },
    budgets: [
      {
        id: "picked",
        limit: 50,
        spent: 44,
        scope: "each",
        per: "set",
        coverage: "models",
        models: [
          { providerID: "opencode", modelID: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
          { providerID: "opencode", modelID: "claude-opus-5", name: "Claude Opus 5" },
        ],
        vendors: [],
        picked: true,
        shared: false,
        resetsAt: Date.parse(resetsAt),
      },
    ],
  }
  await using setup = await createAppFixture({
    width: 110,
    height: 36,
    state: state.path,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" }, experimental: { "new-designs": true } },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [
            {
              id: "msg_refused",
              type: "assistant",
              agent: "build",
              model: session.model,
              content: [],
              finish: "error",
              error: {
                type: "provider.model-budget-limit",
                message: "You've reached the spend limit for this model. Switch models to keep going.",
                status: 429,
                response: {
                  body: JSON.stringify({
                    type: "error",
                    error: { type: "BudgetLimitError", message: "A budget policy for this model has been reached." },
                    metadata: { coverage: "models", resetsAt },
                  }),
                },
              },
              time: { created: 2, completed: 3 },
            },
            { id: "msg_user", type: "user", text: "Refactor the parser", time: { created: 1 } },
          ],
          cursor: {},
        })
      if ([`/api/session/${session.id}/inbox`, `/api/session/${session.id}/permission`].includes(url.pathname))
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider")
        return json({ location, data: [{ id: "opencode", integrationID: "opencode", name: "OpenCode" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [model("gpt-5.6-sol", "GPT 5.6 Sol", 4), model("claude-opus-5", "Claude Opus 5", 5)],
        })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "opencode",
              name: "OpenCode Console",
              methods: [],
              connections: [{ type: "credential", method: "oauth", id: "cred_console", label: "Acme" }],
            },
          ],
        })
      if (url.pathname === "/api/experimental/usage/limits") return json({ location, data: limits })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Refactor the parser"))
  // The refused turn says which limit stopped it and how to keep going, and the composer warns as the model runs low.
  await setup.waitForFrame(
    (frame) =>
      frame.includes("GPT 5.6 Sol usage limit reached") &&
      frame.includes("Switch model with") &&
      /GPT 5\.6 Sol OpenCode +\$6 left/.test(frame) &&
      frame.includes("Running low on GPT 5.6 Sol"),
  )

  await setup.mockInput.typeText("/usage")
  setup.mockInput.pressEnter()
  // Shared money would look counted twice on every row, so only the selected model shows its amount.
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Workspace: Acme") &&
      /Claude Opus 5 +\$6 left/.test(frame) &&
      !/GPT 5\.6 Sol +\$6 left/.test(frame),
  )

  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Usage › Claude Opus 5") &&
      frame.includes("$6 remaining") &&
      frame.includes("$44 used of $50") &&
      frame.includes("Only you · GPT 5.6 Sol, Claude Opus 5"),
  )

  // The model picker says what's left on the model it highlights, and opens the same usage list.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Usage › Claude Opus 5"))
  await setup.mockInput.typeText("/models")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Search models") && /\$6 left +\$4\/\$20 per 1M/.test(frame) && frame.includes("usage ctrl+u"),
  )
})
