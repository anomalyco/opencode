import { test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

const model = (providerID: string, id: string, name: string) => ({
  id,
  modelID: id,
  providerID,
  name,
  status: "active",
  enabled: true,
  cost: [{ input: 1, output: 5, cache: { read: 0, write: 0 } }],
  capabilities: { input: ["text"], output: ["text"], reasoning: false, toolCall: true, attachment: false },
  limit: { context: 1_000_000, output: 64_000 },
  variants: [],
  time: { released: 1 },
})

const providers = {
  native: { id: "opencode", integrationID: "opencode", name: "Anomaly / OpenCode" },
  managed: { id: "console-openai", integrationID: "opencode", canonical: "openai", name: "Anomaly / OpenAI" },
  direct: { id: "openai", name: "OpenAI" },
}

async function composer(input: {
  selected: { providerID: string; id: string }
  providers: readonly object[]
  expected: RegExp
}) {
  await using state = await tmpdir()
  const session = {
    id: "ses_model_label",
    projectID: "proj_test",
    location: { directory },
    title: "Model label",
    agent: "build",
    model: input.selected,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    state: state.path,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [{ id: "msg_user", type: "user", text: "Refactor the parser", time: { created: 1 } }],
          cursor: {},
        })
      if ([`/api/session/${session.id}/inbox`, `/api/session/${session.id}/permission`].includes(url.pathname))
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: input.providers })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            model("opencode", "gpt-6.1-sol", "GPT-6.1 Sol"),
            model("console-openai", "gpt-6.1-sol", "GPT-6.1 Sol"),
            model("openai", "gpt-6-luna", "GPT-6 Luna"),
          ].filter((item) => input.providers.some((provider) => "id" in provider && provider.id === item.providerID)),
        })
      if (url.pathname === "/api/experimental/usage/limits") return json({ location, data: null })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Refactor the parser") && input.expected.test(frame))
}

test("a native Console model shows just its name", () =>
  composer({
    selected: { providerID: "opencode", id: "gpt-6.1-sol" },
    providers: [providers.native, providers.managed],
    expected: /Build · GPT-6\.1 Sol *\n/,
  }))

test("a managed provider drops its workspace", () =>
  composer({
    selected: { providerID: "console-openai", id: "gpt-6.1-sol" },
    providers: [providers.native, providers.managed],
    expected: /Build · GPT-6\.1 Sol OpenAI *\n/,
  }))

test("a managed provider also connected directly routes through OpenCode", () =>
  composer({
    selected: { providerID: "console-openai", id: "gpt-6.1-sol" },
    providers: [providers.native, providers.managed, providers.direct],
    expected: /Build · GPT-6\.1 Sol OpenCode \/ OpenAI *\n/,
  }))

test("the direct route keeps its provider name", () =>
  composer({
    selected: { providerID: "openai", id: "gpt-6-luna" },
    providers: [providers.native, providers.managed, providers.direct],
    expected: /Build · GPT-6 Luna OpenAI *\n/,
  }))
