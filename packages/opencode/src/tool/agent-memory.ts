import z from "zod"
import { Tool } from "./tool"
import { AgentMemory } from "../agent/memory"
import DESCRIPTION from "./agent-memory.txt"

export const AgentMemoryTool = Tool.define("agent_memory", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z
      .enum(["read", "write", "append"])
      .describe("The operation to perform"),
    content: z
      .string()
      .optional()
      .describe("Content to write or append (required for write/append)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "agent_memory",
      patterns: [params.operation],
      always: ["*"],
      metadata: {},
    })

    if (params.operation === "read") {
      const memory = AgentMemory.read(ctx.agent)
      if (!memory) {
        return {
          title: "No memory found",
          output: `No stored memory found for agent "${ctx.agent}" in this project. This is a fresh start.`,
          metadata: { agent: ctx.agent },
        }
      }
      return {
        title: "Memory loaded",
        output: memory.content,
        metadata: {
          agent: ctx.agent,
          updated: memory.time.updated,
        },
      }
    }

    if (params.operation === "write") {
      if (!params.content)
        throw new Error("content is required for write operation")
      AgentMemory.write(ctx.agent, params.content)
      return {
        title: "Memory updated",
        output: `Memory for agent "${ctx.agent}" has been updated.`,
        metadata: { agent: ctx.agent },
      }
    }

    // append
    if (!params.content)
      throw new Error("content is required for append operation")
    AgentMemory.append(ctx.agent, params.content)
    return {
      title: "Memory appended",
      output: `New content appended to memory for agent "${ctx.agent}".`,
      metadata: { agent: ctx.agent },
    }
  },
})
