import { Plugin } from "../plugin"
import type { Tool } from "@/tool/tool"
import { Log } from "../util/log"

const logger = Log.create({ service: "session/tool-executor" })

export namespace ToolExecutor {
  /**
   * Centralized tool execution logic.
   *
   * This function encapsulates the common pattern for executing tools:
   * 1. Trigger "tool.execute.before" plugin hook
   * 2. Execute the tool with error handling
   * 3. Trigger "tool.execute.after" plugin hook
   * 4. Handle errors with logging
   *
   * Used by:
   * - Standard tool execution (prompt.ts:700-723)
   * - Subtask tool execution (prompt.ts:318-429)
   * - Special tool cases (e.g., list tool auto-invocation)
   *
   * @param toolID - The tool identifier (e.g., "bash", "read")
   * @param tool - The initialized tool info object (result of await toolInfo.init())
   * @param args - The arguments to pass to the tool
   * @param ctx - The tool execution context
   * @returns The tool execution result or undefined if execution failed
   */
  export async function execute<T extends Tool.Metadata = Tool.Metadata>(
    toolID: string,
    tool: Awaited<ReturnType<Tool.Info["init"]>>,
    args: any,
    ctx: Tool.Context,
  ): Promise<{ title: string; metadata: T; output: string; attachments?: any[] } | undefined> {
    try {
      // Trigger before hook
      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: toolID,
          sessionID: ctx.sessionID,
          callID: ctx.callID,
        },
        { args },
      )

      // Execute tool
      const result = await tool.execute(args, ctx)

      // Trigger after hook
      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: toolID,
          sessionID: ctx.sessionID,
          callID: ctx.callID,
        },
        result,
      )

      return result
    } catch (error) {
      const err = error as Error

      logger.error("Tool execution failed", {
        tool: toolID,
        error: err.message,
        sessionID: ctx.sessionID,
        callID: ctx.callID,
      })

      return undefined
    }
  }
}
