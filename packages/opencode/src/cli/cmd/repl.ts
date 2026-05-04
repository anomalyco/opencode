import { UI } from "../ui"
import { Thread } from "@/cli/cmd/tui/thread"
import { type Terminal, createTerminal } from "../ui/terminal"
import { colorizeDiff, isDiff, renderRunningTask, renderTool } from "./render"
import { Command } from "@/cli/command"
import type { Message, Part, ToolCallPart, ToolPart } from "@opencode-ai/sdk/v2"
import { Env } from "@/util/env"
import { Agent } from "@/agent/agent"
import { Task } from "@/task/task"
import { randomId } from "@/util/id"
import { Config } from "@/config"
import { ConfigAgent } from "@/config/agent"
import { Models } from "@/provider/models"
import { openCodeModel } from "@/provider/opencode"

export const ReplCommand = Command.define({
  name: "repl",
  description: "Start a REPL session",
  args: {
    model: {
      type: "string",
      description: "The model to use",
    },
    agent: {
      type: "string",
      description: "The agent to use",
    },
  },
  async run(context) {
    const thread = await Thread.active()
    const terminal = createTerminal({
      prompt: "» ",
      threadId: thread.id,
    })

    UI.println(
      UI.Style.TEXT_DIM +
        `opencode · session ${thread.id} · ctrl+d to exit · /help for commands · Tab to autocomplete`,
    )
    UI.empty()

    // Setup Agent
    const agentName = context.args.agent || ConfigAgent.get().defaultAgent
    const agent = Agent.findById(agentName)
    if (!agent) {
      UI.error(`Agent not found: ${agentName}`)
      return
    }

    // Setup Model
    const modelId = context.args.model || ConfigAgent.get().defaultModel
    const model = Models.find(modelId) || openCodeModel(modelId)

    const session = Task.create({
      agent,
      model,
      thread,
    })

    while (true) {
      const input = await terminal.read()
      if (input === null) break

      const trimmedInput = input.trim()
      if (trimmedInput === "") continue

      if (trimmedInput.startsWith("/")) {
        const [cmd, ...args] = trimmedInput.slice(1).split(" ")
        if (cmd === "exit" || cmd === "quit") break
        if (cmd === "help") {
          UI.println(UI.Style.TEXT_BOLD + "Commands:")
          UI.println("  /help          Show this help message")
          UI.println("  /exit, /quit   Exit the REPL")
          UI.println("  /clear         Clear the terminal")
          UI.println("  /thread        Show current thread ID")
          UI.println("  /model         Show current model")
          UI.println("  /agent         Show current agent")
          UI.empty()
          continue
        }
        if (cmd === "clear") {
          console.clear()
          continue
        }
        if (cmd === "thread") {
          UI.println(`Current thread: ${thread.id}`)
          continue
        }
        if (cmd === "model") {
          UI.println(`Current model: ${model.id}`)
          continue
        }
        if (cmd === "agent") {
          UI.println(`Current agent: ${agent.id}`)
          continue
        }
        UI.error(`Unknown command: ${cmd}`)
        continue
      }

      await session.run({
        input: trimmedInput,
        onPart: (part) => {
          if (part.type === "text") {
            UI.print(part.text)
          } else if (part.type === "tool") {
            renderTool(part)
          }
        },
      })
      UI.empty()
    }
  },
})
