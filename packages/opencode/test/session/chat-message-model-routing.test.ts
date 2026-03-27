import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { TaskTool } from "../../src/tool/task"
import { Env } from "../../src/env"

Log.init({ print: false })

async function writeModelRewritePlugin(dir: string, targetProviderID: string, targetModelID: string) {
  const pluginDir = path.join(dir, ".opencode", "plugin")
  await Bun.write(
    path.join(pluginDir, "model-rewrite.ts"),
    `export default async () => ({
  "chat.message": async (input, output) => {
    if (output.message.role !== "user") return
    output.message.model = {
      providerID: "${targetProviderID}",
      modelID: "${targetModelID}",
    }
  },
})`,
  )
}

describe("chat.message model routing", () => {
  test("user message persists with plugin-rewritten model", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-sonnet-20241022"

    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2-codex",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writeModelRewritePlugin(tmp.path, rewriteProvider, rewriteModel)

        const session = await Session.create({})

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const userInfo = msg.info as MessageV2.User
        expect(userInfo.model.providerID as string).toBe(rewriteProvider)
        expect(userInfo.model.modelID as string).toBe(rewriteModel)

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const storedUserInfo = stored.info as MessageV2.User
        expect(storedUserInfo.model.providerID as string).toBe(rewriteProvider)
        expect(storedUserInfo.model.modelID as string).toBe(rewriteModel)

        await Session.remove(session.id)
      },
    })
  })

  test("user message persists with plugin-rewritten model across providers", async () => {
    const rewriteProvider = "alibaba"
    const rewriteModel = "qwen-plus"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeModelRewritePlugin(dir, rewriteProvider, rewriteModel)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["alibaba", "openai"],
            agent: {
              build: {
                model: "openai/gpt-5.2-codex",
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "say hello" }],
        })

        const msgs = await MessageV2.filterCompacted(MessageV2.stream(session.id))
        const userMsg = msgs.find((m) => m.info.role === "user")!
        const userInfo = userMsg.info as MessageV2.User
        expect(userInfo.model.providerID as string).toBe(rewriteProvider)
        expect(userInfo.model.modelID as string).toBe(rewriteModel)

        await Session.remove(session.id)
      },
    })
  })

  test("parent assistant inherits routed model from user message", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-haiku-latest"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeModelRewritePlugin(dir, rewriteProvider, rewriteModel)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [rewriteProvider, "openai"],
            agent: {
              build: {
                model: "openai/gpt-5.2-codex",
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
        Env.set("OPENAI_API_KEY", "test-openai-key")
      },
      fn: async () => {
        const session = await Session.create({})

        const userMsg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        if (userMsg.info.role !== "user") throw new Error("expected user message")
        const userInfo = userMsg.info as MessageV2.User
        expect(userInfo.model.providerID as string).toBe(rewriteProvider)
        expect(userInfo.model.modelID as string).toBe(rewriteModel)

        const parentAssistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: userMsg.info.id,
          modelID: ModelID.make(userInfo.model.modelID as string),
          providerID: ProviderID.make(userInfo.model.providerID as string),
          agent: "build",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        const assistantInfo = parentAssistant as MessageV2.Assistant
        expect(String(assistantInfo.modelID)).toBe(rewriteModel)
        expect(String(assistantInfo.providerID)).toBe(rewriteProvider)

        await Session.remove(session.id)
      },
    })
  })

  test("subagent inherits parent assistant model when no explicit agent model", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-haiku-latest"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeModelRewritePlugin(dir, rewriteProvider, rewriteModel)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [rewriteProvider, "openai"],
            agent: {
              build: {
                model: "openai/gpt-5.2-codex",
              },
              explorer: {
                description: "Explores files",
                mode: "subagent",
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
        Env.set("OPENAI_API_KEY", "test-openai-key")
      },
      fn: async () => {
        const explorer = await Agent.get("explorer")
        expect(explorer).not.toBeNull()
        expect(explorer!.model).toBeUndefined()

        const session = await Session.create({})

        const userMsg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "call @explorer" }],
        })

        if (userMsg.info.role !== "user") throw new Error("expected user message")
        const userInfo = userMsg.info as MessageV2.User
        expect(userInfo.model.providerID as string).toBe(rewriteProvider)
        expect(userInfo.model.modelID as string).toBe(rewriteModel)

        const parentAssistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: userMsg.info.id,
          modelID: ModelID.make(userInfo.model.modelID as string),
          providerID: ProviderID.make(userInfo.model.providerID as string),
          agent: "build",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        const abort = new AbortController()
        const taskTool = await TaskTool.init({ agent: explorer! })
        const taskCtx = {
          agent: "explorer",
          messageID: parentAssistant.id,
          sessionID: session.id,
          abort: abort.signal,
          callID: "test-call-id",
          extra: { bypassAgentCheck: true },
          messages: [],
          async metadata(_input: any) {},
          async ask(_req: any) {},
        }

        const result = await taskTool.execute(
          {
            prompt: "test prompt",
            description: "test task",
            subagent_type: "explorer",
          },
          taskCtx as any,
        )

        expect(result).toBeDefined()
        expect(result!.metadata).toBeDefined()
        expect(result!.metadata.model).toBeDefined()
        expect(result!.metadata.model.providerID as string).toBe(rewriteProvider)
        expect(result!.metadata.model.modelID as string).toBe(rewriteModel)

        await Session.remove(session.id)
      },
    })
  })

  test("pinned agent model overrides inherited routed model", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-haiku-latest"
    const pinnedModel = "openai/gpt-5.2-codex"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeModelRewritePlugin(dir, rewriteProvider, rewriteModel)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [rewriteProvider, "openai"],
            agent: {
              build: { model: "openai/gpt-5.2-codex" },
              explorer: {
                description: "Explores files",
                mode: "subagent",
                model: pinnedModel,
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
        Env.set("OPENAI_API_KEY", "test-openai-key")
      },
      fn: async () => {
        const explorer = await Agent.get("explorer")
        expect(explorer).not.toBeNull()
        expect(explorer!.model?.providerID as string).toBe("openai")
        expect(explorer!.model?.modelID as string).toBe("gpt-5.2-codex")

        const session = await Session.create({})

        const userMsg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "call @explorer" }],
        })

        if (userMsg.info.role !== "user") throw new Error("expected user message")
        const userInfo = userMsg.info as MessageV2.User
        expect(userInfo.model.providerID as string).toBe(rewriteProvider)
        expect(userInfo.model.modelID as string).toBe(rewriteModel)

        const parentAssistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: userMsg.info.id,
          modelID: ModelID.make(userInfo.model.modelID as string),
          providerID: ProviderID.make(userInfo.model.providerID as string),
          agent: "build",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        const abort = new AbortController()
        const taskTool = await TaskTool.init({ agent: explorer! })
        const taskCtx = {
          agent: "explorer",
          messageID: parentAssistant.id,
          sessionID: session.id,
          abort: abort.signal,
          callID: "test-call-id",
          extra: { bypassAgentCheck: true },
          messages: [],
          async metadata(_input: any) {},
          async ask(_req: any) {},
        }

        const result = await taskTool.execute(
          {
            prompt: "test prompt",
            description: "test task",
            subagent_type: "explorer",
          },
          taskCtx as any,
        )

        expect(result).toBeDefined()
        expect(result!.metadata).toBeDefined()
        expect(result!.metadata.model).toBeDefined()
        expect(result!.metadata.model.providerID as string).toBe("openai")
        expect(result!.metadata.model.modelID as string).toBe("gpt-5.2-codex")

        await Session.remove(session.id)
      },
    })
  })

  test("plugin rewriting to unknown model provider throws ModelNotFoundError", async () => {
    const unknownProvider = "nonexistent-provider-xyz"
    const modelID = "some-model"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Provider.getModel(ProviderID.make(unknownProvider), ModelID.make(modelID))).rejects.toThrow()
      },
    })
  })

  test("plugin rewriting to unknown model ID throws ModelNotFoundError", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["anthropic"],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
      },
      fn: async () => {
        await expect(Provider.getModel(ProviderID.anthropic, ModelID.make("nonexistent-model-xyz"))).rejects.toThrow()
      },
    })
  })

  test("plugin returns valid model for rewrite", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-haiku-latest"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [rewriteProvider],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
      },
      fn: async () => {
        const model = await Provider.getModel(ProviderID.make(rewriteProvider), ModelID.make(rewriteModel))
        expect(model).toBeDefined()
        expect(String(model.id)).toBe(rewriteModel)
      },
    })
  })

  test("model inherits from user message through assistant to subagent", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-haiku-latest"

    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeModelRewritePlugin(dir, rewriteProvider, rewriteModel)
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: [rewriteProvider, "openai"],
            agent: {
              build: { model: "openai/gpt-5.2-codex" },
              explorer: {
                description: "Explores files",
                mode: "subagent",
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-api-key")
        Env.set("OPENAI_API_KEY", "test-openai-key")
      },
      fn: async () => {
        const explorer = await Agent.get("explorer")
        expect(explorer).not.toBeNull()
        expect(explorer!.model).toBeUndefined()

        const session = await Session.create({})

        const userMsg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "call @explorer" }],
        })

        if (userMsg.info.role !== "user") throw new Error("expected user message")
        const userInfo = userMsg.info as MessageV2.User

        const parentAssistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: userMsg.info.id,
          modelID: ModelID.make(userInfo.model.modelID as string),
          providerID: ProviderID.make(userInfo.model.providerID as string),
          agent: "build",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        const abort = new AbortController()
        const taskTool = await TaskTool.init({ agent: explorer! })
        const taskCtx = {
          agent: "explorer",
          messageID: parentAssistant.id,
          sessionID: session.id,
          abort: abort.signal,
          callID: "test-call-id",
          extra: { bypassAgentCheck: true },
          messages: [],
          async metadata(_input: any) {},
          async ask(_req: any) {},
        }

        const result = await taskTool.execute(
          {
            prompt: "test prompt",
            description: "test task",
            subagent_type: "explorer",
          },
          taskCtx as any,
        )

        const assistantInfo = parentAssistant as MessageV2.Assistant
        expect(String(assistantInfo.modelID)).toBe(rewriteModel)
        expect(String(assistantInfo.providerID)).toBe(rewriteProvider)
        expect(result!.metadata.model.providerID as string).toBe(rewriteProvider)
        expect(result!.metadata.model.modelID as string).toBe(rewriteModel)

        await Session.remove(session.id)
      },
    })
  })

  test("session model is persisted after plugin rewrite", async () => {
    const rewriteProvider = "anthropic"
    const rewriteModel = "claude-3-5-sonnet-20241022"

    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2-codex",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writeModelRewritePlugin(tmp.path, rewriteProvider, rewriteModel)

        const session = await Session.create({})

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        const updated = await Session.get(session.id)
        expect(updated.model?.providerID).toBe(rewriteProvider)
        expect(updated.model?.modelID).toBe(rewriteModel)

        await Session.remove(session.id)
      },
    })
  })
})
