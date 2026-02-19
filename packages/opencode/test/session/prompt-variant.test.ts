import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Agent } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "opencode", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })

  test("explicit variant input takes effect without agent variant config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Simulates what task.ts does: passing parent's variant as explicit input
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "general",
          variant: "high",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        if (msg.info.role !== "user") throw new Error("expected user message")
        expect(msg.info.variant).toBe("high")

        await Session.remove(session.id)
      },
    })
  })

  test("subagent inherits variant from parent session user message", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // 1. Create a parent session and send a user message with variant
        const parent = await Session.create({})
        const parentMsg = await SessionPrompt.prompt({
          sessionID: parent.id,
          variant: "high",
          noReply: true,
          parts: [{ type: "text", text: "use @general to explore the codebase" }],
        })
        if (parentMsg.info.role !== "user") throw new Error("expected user message")
        expect(parentMsg.info.variant).toBe("high")

        // 2. Simulate what task.ts does: read back the parent user message
        //    and compute the inherited variant for the subagent
        const agent = await Agent.get("general")
        const resolved = !agent.variant && parentMsg.info.role === "user" ? parentMsg.info.variant : undefined
        expect(resolved).toBe("high")

        // 3. Create a child session (like task.ts does) and prompt with inherited variant
        const child = await Session.create({ parentID: parent.id })
        const childMsg = await SessionPrompt.prompt({
          sessionID: child.id,
          agent: "general",
          variant: resolved,
          noReply: true,
          parts: [{ type: "text", text: "explore the project structure" }],
        })
        if (childMsg.info.role !== "user") throw new Error("expected user message")
        expect(childMsg.info.variant).toBe("high")

        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("subagent does not inherit variant when agent has own variant", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
            variant: "xhigh",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // 1. Parent message with variant="high"
        const parent = await Session.create({})
        const parentMsg = await SessionPrompt.prompt({
          sessionID: parent.id,
          variant: "high",
          noReply: true,
          parts: [{ type: "text", text: "use @build to compile" }],
        })
        if (parentMsg.info.role !== "user") throw new Error("expected user message")
        expect(parentMsg.info.variant).toBe("high")

        // 2. Agent "build" has its own variant="xhigh", so inheritance should NOT happen
        const agent = await Agent.get("build")
        const resolved = !agent.variant && parentMsg.info.role === "user" ? parentMsg.info.variant : undefined
        expect(resolved).toBeUndefined()

        // 3. When variant=undefined, the child session uses agent's own variant via prompt.ts
        const child = await Session.create({ parentID: parent.id })
        const childMsg = await SessionPrompt.prompt({
          sessionID: child.id,
          agent: "build",
          variant: resolved,
          noReply: true,
          parts: [{ type: "text", text: "compile the project" }],
        })
        if (childMsg.info.role !== "user") throw new Error("expected user message")
        // agent.variant="xhigh" is applied by prompt.ts since we're using the agent's model
        expect(childMsg.info.variant).toBe("xhigh")

        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })
})
