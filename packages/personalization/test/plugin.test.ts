import { describe, expect, it } from "bun:test"
import { createPersonalizationPlugin } from "../src/plugin"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { ExtractedSignals } from "../src/extractor"

type ChatMessageOutput = Parameters<NonNullable<Hooks["chat.message"]>>[1]
type ChatTransformOutput = Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[1]
type ChatTransformInput = Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[0]
type SessionCompactOutput = Parameters<NonNullable<Hooks["experimental.session.compacting"]>>[1]

describe("Plugin Module", () => {
  const testEmbedder = async () => new Float32Array([1, 0, 0])

  const testExtractor = async (text: string): Promise<ExtractedSignals> => {
    if (text.includes("plain functions")) {
      return {
        profileDelta: {
          languages: ["typescript"],
          style: { explicitness: 0.95, abstraction_tolerance: 0.2 },
        },
        preferenceMemories: [
          {
            tier: "preference",
            category: "style",
            content: "Prefers plain functions and explicit code",
            confidence: 0.95,
          },
        ],
        semanticMemories: [
          {
            tier: "semantic",
            category: "tech_stack",
            content: "Project uses vitest for testing",
            confidence: 0.9,
          },
        ],
        workingMemories: [],
      }
    }
    return {
      preferenceMemories: [],
      semanticMemories: [],
      workingMemories: [],
    }
  }

  it("should initialize hooks and transform system prompt", async () => {
    const pluginFactory = createPersonalizationPlugin({
      embedder: testEmbedder,
      extractor: testExtractor,
    })
    const hooks = await pluginFactory({} as PluginInput)

    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
    expect(hooks["chat.message"]).toBeDefined()
    expect(hooks["experimental.session.compacting"]).toBeDefined()

    const systemOutput: ChatTransformOutput = { system: [] }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await hooks["experimental.chat.system.transform"]!({} as ChatTransformInput, systemOutput)

    expect(systemOutput.system.length).toBe(1)
    expect(systemOutput.system[0]).toContain("PERSONALIZED DEVELOPER CONTEXT")
  })

  it("should extract signals on chat.message and drift profile", async () => {
    const pluginFactory = createPersonalizationPlugin({
      embedder: testEmbedder,
      extractor: testExtractor,
    })
    const hooks = await pluginFactory({} as PluginInput)

    const userMessage: ChatMessageOutput = {
      message: {
        id: "msg_1",
        sessionID: "s1",
        role: "user",
        created: Date.now(),
      } as unknown as ChatMessageOutput["message"],
      parts: [
        {
          id: "p1",
          sessionID: "s1",
          messageID: "msg_1",
          type: "text",
          text: "Don't use classes here, prefer plain functions and be concise. Also we use vitest.",
        } as unknown as ChatMessageOutput["parts"][number],
      ],
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await hooks["chat.message"]!({ sessionID: "s1" }, userMessage)

    // Verify that subsequent system transform incorporates updated preferences
    const systemOutput: ChatTransformOutput = { system: [] }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await hooks["experimental.chat.system.transform"]!({} as ChatTransformInput, systemOutput)

    expect(systemOutput.system[0]).toContain("plain functions")
    expect(systemOutput.system[0]).toContain("vitest")
  })

  it("should inject preserved preferences on session compacting", async () => {
    const pluginFactory = createPersonalizationPlugin({
      embedder: testEmbedder,
      extractor: testExtractor,
    })
    const hooks = await pluginFactory({} as PluginInput)

    const userMessage: ChatMessageOutput = {
      message: {
        id: "msg_1",
        sessionID: "s1",
        role: "user",
        created: Date.now(),
      } as unknown as ChatMessageOutput["message"],
      parts: [
        {
          id: "p1",
          sessionID: "s1",
          messageID: "msg_1",
          type: "text",
          text: "Don't use classes, prefer plain functions",
        } as unknown as ChatMessageOutput["parts"][number],
      ],
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await hooks["chat.message"]!({ sessionID: "s1" }, userMessage)

    const compactOutput: SessionCompactOutput = { context: [] }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await hooks["experimental.session.compacting"]!({ sessionID: "s1" }, compactOutput)

    expect(compactOutput.context.length).toBe(1)
    expect(compactOutput.context[0]).toContain("Preserved Developer Preferences")
  })
})
