import { CommandExecutionContext, CommandExecutionResult, CustomCommand } from "./types"
import { CommandResolver } from "./resolver"
import { CommandParser } from "./parser"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { App } from "../app/app"
import { Log } from "../util/log"

export class CommandExecutor {
  private resolver: CommandResolver
  private log = Log.create({ service: "command-executor" })
  
  constructor(private app: App.Info) {
    this.resolver = new CommandResolver(app)
  }

  async execute(
    command: CustomCommand,
    args: string,
    sessionId: string,
    messageId: string
  ): Promise<CommandExecutionResult> {
    try {
      const context: CommandExecutionContext = {
        command,
        arguments: args,
        sessionId,
        messageId,
        workingDirectory: this.app.path.cwd,
      }
      
      // Resolve dynamic content
      const processedContent = await this.resolver.resolve(
        command.rawContent,
        context
      )
      
      // Parse tool restrictions
      const toolRestrictions = command.metadata["allowed-tools"]
        ? CommandParser.parseAllowedTools(command.metadata["allowed-tools"])
        : []
      
      // Create a synthetic user message
      const newMessageId = Identifier.ascending("message")
      const parts: MessageV2.Part[] = [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: processedContent,
        },
      ]
      
      // Get current session and model info
      const msg = await Session.getMessage(sessionId, messageId)
      
      // Build tools object based on restrictions
      const tools: Record<string, boolean> = {}
      if (toolRestrictions.length > 0) {
        // Start with all tools disabled
        const allTools = ["bash", "read", "write", "edit", "glob", "grep", "ls", "webfetch", "task", "todoread", "todowrite"]
        for (const tool of allTools) {
          tools[tool] = false
        }
        
        // Enable only allowed tools
        for (const restriction of toolRestrictions) {
          tools[restriction.toolName.toLowerCase()] = true
        }
      }
      
      // Send to AI with tool restrictions
      const result = await Session.chat({
        messageID: newMessageId,
        sessionID: sessionId,
        modelID: msg.modelID,
        providerID: msg.providerID,
        mode: msg.mode,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        parts,
      })
      
      return {
        success: true,
        output: result.parts.find(p => p.type === "text")?.text || "",
      }
    } catch (error) {
      this.log.error("Command execution failed:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }
}