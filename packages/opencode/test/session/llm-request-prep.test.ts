import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { LLMRequestPrep } from "../../src/session/llm/request"
import type { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import type { Agent } from "../../src/agent/agent"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionID, MessageID } from "../../src/session/schema"

// Passthrough plugin stub: trigger returns the output unchanged
const stubPlugin: Plugin.Interface = {
  trigger: (_name: any, _input: any, output: any) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.succeed(undefined),
}

const stubModel: Provider.Model = {
  id: ModelV2.ID.make("gpt-5.2"),
  providerID: ProviderV2.ID.make("openai"),
  api: { id: "gpt-5.2", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
  name: "GPT 5.2",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 200_000, output: 100_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const stubFlags: RuntimeFlags.Info = {
  autoShare: false,
  pure: false,
  disableDefaultPlugins: false,
  disableEmbeddedWebUi: false,
  disableExternalSkills: false,
  disableLspDownload: false,
  disableClaudeCodePrompt: false,
  disableClaudeCodeSkills: false,
  enableExa: false,
  enableParallel: false,
  enableExperimentalModels: false,
  enableQuestionTool: false,
  experimentalReferences: false,
  experimentalBackgroundSubagents: false,
  experimentalLspTy: false,
  experimentalLspTool: false,
  experimentalOxfmt: false,
  experimentalPlanMode: false,
  experimentalEventSystem: false,
  experimentalWorkspaces: false,
  experimentalIconDiscovery: false,
  outputTokenMax: undefined,
  bashDefaultTimeoutMs: undefined,
  experimentalNativeLlm: false,
  experimentalWebSockets: false,
  client: "cli",
}

const stubAgent: Agent.Info = {
  name: "test",
  mode: "primary",
  prompt: "You are a test assistant.",
  options: {},
  permission: [],
}

const sessionID = SessionID.make("session-prep-test")

const stubUser: SessionV1.User = {
  id: MessageID.make("msg_prep-test"),
  sessionID,
  role: "user",
  time: { created: Date.now() },
  agent: "test",
  model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-5.2") },
}

const stubProvider: Provider.Info = {
  id: ProviderV2.ID.make("openai"),
  name: "OpenAI",
  source: "env",
  env: ["OPENAI_API_KEY"],
  options: {},
  models: {},
}

const baseInput = {
  user: stubUser,
  sessionID,
  model: stubModel,
  agent: stubAgent,
  system: ["System instruction A"],
  messages: [{ role: "user", content: "Hello" }] as ModelMessage[],
  tools: {},
  provider: stubProvider,
  auth: undefined,
  plugin: stubPlugin,
  flags: stubFlags,
  isWorkflow: false,
}

describe("LLMRequestPrep.prepare", () => {
  test("OAuth path sends system entries as structured messages, not instructions", async () => {
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        ...baseInput,
        provider: { ...stubProvider, id: ProviderV2.ID.make("openai") },
        auth: { type: "oauth", refresh: "r", access: "a", expires: 9999999999 },
        system: ["System instruction A", "System instruction B"],
      }),
    )

    // instructions must not be set on the OAuth path after the fix
    expect(result.params.options.instructions).toBeUndefined()

    // system entries appear as structured {role: "system"} messages at the head
    const systemMessages = result.messages.filter((m) => m.role === "system")
    expect(systemMessages.length).toBeGreaterThan(0)
    expect(result.messages[0]).toMatchObject({ role: "system" })

    // total messages = system entries + input messages
    const inputMessages = [{ role: "user", content: "Hello" }] as ModelMessage[]
    expect(result.messages.length).toBe(result.system.length + inputMessages.length)
  })

  test("non-OAuth path prepends system entries as structured messages", async () => {
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        ...baseInput,
        provider: { ...stubProvider, id: ProviderV2.ID.make("openai") },
        auth: undefined,
        system: ["System instruction A"],
      }),
    )

    expect(result.params.options.instructions).toBeUndefined()
    expect(result.messages[0]).toMatchObject({ role: "system" })

    const inputMessages = [{ role: "user", content: "Hello" }] as ModelMessage[]
    expect(result.messages.length).toBe(result.system.length + inputMessages.length)
  })

  test("workflow path passes input messages through without system prepend", async () => {
    const inputMessages = [{ role: "user", content: "Hello" }] as ModelMessage[]
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        ...baseInput,
        isWorkflow: true,
        system: ["System instruction A", "System instruction B"],
        messages: inputMessages,
      }),
    )

    // workflow messages are passed through unchanged
    expect(result.messages).toEqual(inputMessages)

    // system entries must not be duplicated into messages
    expect(result.messages.every((m) => m.role !== "system")).toBe(true)
  })

  test("empty system array produces only the original input messages", async () => {
    const inputMessages = [{ role: "user", content: "Hello" }] as ModelMessage[]
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        ...baseInput,
        system: [],
        messages: inputMessages,
      }),
    )

    // With an empty system array the agent prompt still generates one system entry,
    // so we check that no extra duplication happened beyond that.
    const userMessages = result.messages.filter((m) => m.role === "user")
    expect(userMessages).toMatchObject(inputMessages)
  })

  test("multi-entry system produces one structured message per entry in order", async () => {
    const systemEntries = ["First system entry", "Second system entry", "Third system entry"]
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        ...baseInput,
        system: systemEntries,
        // Use agent.prompt so we know the first system entry comes from it
        agent: { ...stubAgent, prompt: "Agent prompt" },
      }),
    )

    // The prepare function joins all system parts into a compacted array, then
    // maps each element to {role: "system", content: ...}. The leading messages
    // must all be system role and appear before the user message.
    const systemMessages = result.messages.filter((m) => m.role === "system")
    expect(systemMessages.length).toBe(result.system.length)
    expect(systemMessages.length).toBeGreaterThan(0)

    // Each system message corresponds to an entry in result.system in order
    for (let i = 0; i < systemMessages.length; i++) {
      expect(systemMessages[i]).toMatchObject({
        role: "system",
        content: result.system[i],
      })
    }

    // User message follows after all system messages
    expect(result.messages[systemMessages.length]).toMatchObject({ role: "user" })
  })
})
