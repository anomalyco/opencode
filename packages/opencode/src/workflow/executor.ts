/**
 * Workflow Task Executor
 *
 * Executes workflow tasks by running specialized agents.
 * This is the core execution engine that bridges the orchestrator
 * and the agent system.
 */

import { Provider } from "../provider/provider.js"
import { streamText } from "ai"
import { Orchestrator } from "./orchestrator.js"
import { Workspace } from "./workspace.js"
import { getAgentForStage } from "./agents.js"
import { Log } from "../util/log.js"
import { UI } from "../cli/ui.js"
import type { WorkflowInstance, Task, WorkflowStage } from "./types.js"

const log = Log.create({ service: "executor" })

const ANSI_RESET = "\x1b[0m"
const ANSI_BOLD = "\x1b[1m"
const ANSI_DIM = "\x1b[2m"
const ANSI_CYAN = "\x1b[36m"
const ANSI_GREEN = "\x1b[32m"
const ANSI_YELLOW = "\x1b[33m"
const ANSI_BLUE = "\x1b[34m"
const ANSI_MAGENTA = "\x1b[35m"
const ANSI_RED = "\x1b[31m"
const ANSI_GRAY = "\x1b[90m"

namespace StreamFormatter {
  interface State {
    inCodeBlock: boolean
    codeBlockLanguage: string
    codeBlockLines: string[]
    buffer: string
    lineStart: boolean
    inToolCall: boolean
    toolCallBuffer: string
    toolCallCount: number
  }

  const ANSI_RESET = "\x1b[0m"
  const ANSI_BOLD = "\x1b[1m"
  const ANSI_DIM = "\x1b[2m"
  const ANSI_CYAN = "\x1b[36m"
  const ANSI_GREEN = "\x1b[32m"
  const ANSI_YELLOW = "\x1b[33m"
  const ANSI_BLUE = "\x1b[34m"
  const ANSI_MAGENTA = "\x1b[35m"
  const ANSI_RED = "\x1b[31m"
  const ANSI_GRAY = "\x1b[90m"

  export function create(): State {
    return {
      inCodeBlock: false,
      codeBlockLanguage: "",
      codeBlockLines: [],
      buffer: "",
      lineStart: true,
      inToolCall: false,
      toolCallBuffer: "",
      toolCallCount: 0,
    }
  }

  export function format(state: State, chunk: string): string {
    state.buffer += chunk
    let output = ""

    while (state.buffer.length > 0) {
      if (state.inToolCall) {
        const toolNameMatch = state.toolCallBuffer.match(/<(\w+)>/)
        if (!toolNameMatch) {
          state.toolCallBuffer += state.buffer
          state.buffer = ""
          break
        }

        const toolName = toolNameMatch[1]
        const closingTag = `</${toolName}>`
        const toolCallEnd = (state.toolCallBuffer + state.buffer).indexOf(closingTag)

        if (toolCallEnd === -1) {
          state.toolCallBuffer += state.buffer
          state.buffer = ""
          break
        }

        const fullContent = state.toolCallBuffer + state.buffer
        const endIndex = toolCallEnd + closingTag.length
        state.toolCallBuffer = fullContent.slice(0, endIndex)
        state.buffer = fullContent.slice(endIndex)

        const params: Record<string, string> = {}
        const innerContent = state.toolCallBuffer
          .replace(new RegExp(`^<${toolName}>`), "")
          .replace(new RegExp(`</${toolName}>$`), "")
        const paramMatches = innerContent.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)

        for (const match of paramMatches) {
          params[match[1]] = match[2].trim()
        }

        state.toolCallCount++

        output += `\n${ANSI_CYAN}${ANSI_BOLD}╭${"─".repeat(58)}╮${ANSI_RESET}\n`
        output += `${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET} 🔧 ${ANSI_CYAN}${ANSI_BOLD}Tool Call #${state.toolCallCount}${" ".repeat(58 - 14 - String(state.toolCallCount).length)}${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET}\n`
        output += `${ANSI_CYAN}${ANSI_BOLD}├${"─".repeat(58)}┤${ANSI_RESET}\n`
        output += `${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_YELLOW}Tool:${ANSI_RESET} ${ANSI_BOLD}${toolName}${" ".repeat(58 - 7 - toolName.length)}${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET}\n`
        output += `${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_YELLOW}Args:${" ".repeat(58 - 6)}${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET}\n`

        const argsStr = JSON.stringify(params, null, 2)
        const argsLines = argsStr.split("\n")
        for (const line of argsLines) {
          const displayLine = line.length > 56 ? line.slice(0, 53) + "..." : line
          const padding = " ".repeat(Math.max(0, 58 - displayLine.length))
          output += `${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_GREEN}${displayLine}${padding}${ANSI_CYAN}${ANSI_BOLD}│${ANSI_RESET}\n`
        }

        output += `${ANSI_CYAN}${ANSI_BOLD}╰${"─".repeat(58)}╯${ANSI_RESET}\n\n`

        state.inToolCall = false
        state.toolCallBuffer = ""
        continue
      }

      const possibleToolNames = [
        "read_file",
        "bash",
        "edit",
        "write",
        "glob",
        "grep",
        "list",
        "webfetch",
        "task",
        "todowrite",
        "todoread",
        "search_files",
        "list_files",
        "list_directory",
        "list_dir",
      ]
      const toolCallStart = state.buffer.match(/<(\w+)>/)

      if (toolCallStart && possibleToolNames.includes(toolCallStart[1])) {
        const startIndex = state.buffer.indexOf(toolCallStart[0])
        if (startIndex > 0) {
          const textBefore = state.buffer.slice(0, startIndex)
          state.buffer = state.buffer.slice(startIndex)
          output += textBefore
          continue
        }

        state.inToolCall = true
        state.toolCallBuffer = toolCallStart[0]
        state.buffer = state.buffer.slice(toolCallStart[0].length)
        continue
      }

      if (!state.inCodeBlock) {
        const codeBlockStart = state.buffer.match(/^```(\w*)(\n|$)/)
        if (codeBlockStart) {
          state.inCodeBlock = true
          state.codeBlockLanguage = codeBlockStart[1] || ""
          state.codeBlockLines = []
          state.buffer = state.buffer.slice(codeBlockStart[0].length)
          continue
        }

        const listMatch = state.lineStart && state.buffer.match(/^(\s*)([-*+])\s/)
        if (listMatch) {
          const indent = listMatch[1]
          const bullet = listMatch[2] === "-" ? "◦" : listMatch[2] === "*" ? "•" : "▸"
          output += `${indent}${ANSI_YELLOW}${bullet}${ANSI_RESET} `
          state.buffer = state.buffer.slice(listMatch[0].length)
          state.lineStart = false
          continue
        }

        const numberedListMatch = state.lineStart && state.buffer.match(/^(\s*)(\d+)\.\s/)
        if (numberedListMatch) {
          const indent = numberedListMatch[1]
          const number = numberedListMatch[2]
          output += `${indent}${ANSI_CYAN}${number}.${ANSI_RESET} `
          state.buffer = state.buffer.slice(numberedListMatch[0].length)
          state.lineStart = false
          continue
        }

        const headerMatch = state.lineStart && state.buffer.match(/^(#{1,6})\s+(.+?)(\n|$)/)
        if (headerMatch) {
          const level = headerMatch[1].length
          let text = headerMatch[2]

          text = text.replace(/\*\*(.+?)\*\*/g, `${ANSI_BOLD}$1${ANSI_RESET}${ANSI_CYAN}${ANSI_BOLD}`)
          text = text.replace(/\*(.+?)\*/g, `${ANSI_DIM}$1${ANSI_RESET}${ANSI_CYAN}${ANSI_BOLD}`)
          text = text.replace(
            /`(.+?)`/g,
            `${ANSI_DIM}[${ANSI_RESET}${ANSI_CYAN}$1${ANSI_RESET}${ANSI_DIM}]${ANSI_RESET}${ANSI_CYAN}${ANSI_BOLD}`,
          )

          const styles = [
            { color: ANSI_CYAN + ANSI_BOLD, prefix: "\n━━━ ", suffix: " ━━━\n" },
            { color: ANSI_BLUE + ANSI_BOLD, prefix: "\n▸ ", suffix: "\n" },
            { color: ANSI_MAGENTA + ANSI_BOLD, prefix: "  • ", suffix: "\n" },
            { color: ANSI_YELLOW, prefix: "    ◦ ", suffix: "\n" },
            { color: ANSI_GREEN, prefix: "      › ", suffix: "\n" },
            { color: ANSI_CYAN, prefix: "        - ", suffix: "\n" },
          ]
          const style = styles[Math.min(level - 1, styles.length - 1)]
          output += `${style.color}${style.prefix}${text}${style.suffix}${ANSI_RESET}`
          state.buffer = state.buffer.slice(headerMatch[0].length)
          state.lineStart = headerMatch[3] === "\n"
          continue
        }

        if (state.buffer.startsWith("**")) {
          const endMatch = state.buffer.slice(2).indexOf("**")
          if (endMatch === -1) {
            if (state.buffer.length < 100 && !state.buffer.includes("\n")) {
              break
            }
          } else {
            const text = state.buffer.slice(2, endMatch + 2)
            output += `${ANSI_BOLD}${text}${ANSI_RESET}`
            state.buffer = state.buffer.slice(endMatch + 4)
            continue
          }
        }

        if (state.buffer.startsWith("*") && !state.buffer.startsWith("**") && state.buffer[1] !== " ") {
          const endMatch = state.buffer.slice(1).indexOf("*")
          if (endMatch === -1) {
            if (state.buffer.length < 100 && !state.buffer.includes("\n")) {
              break
            }
          } else {
            const text = state.buffer.slice(1, endMatch + 1)
            output += `${ANSI_DIM}${text}${ANSI_RESET}`
            state.buffer = state.buffer.slice(endMatch + 2)
            continue
          }
        }

        const blockquoteMatch = state.lineStart && state.buffer.match(/^>\s(.+?)(\n|$)/)
        if (blockquoteMatch) {
          const text = blockquoteMatch[1]
          output += `${ANSI_BLUE}▌ ${ANSI_DIM}${text}${ANSI_RESET}${blockquoteMatch[2]}`
          state.buffer = state.buffer.slice(blockquoteMatch[0].length)
          state.lineStart = blockquoteMatch[2] === "\n"
          continue
        }

        if (state.buffer.startsWith("`") && !state.buffer.startsWith("```")) {
          const endMatch = state.buffer.slice(1).indexOf("`")
          if (endMatch === -1) {
            if (state.buffer.length < 100 && !state.buffer.includes("\n")) {
              break
            }
          } else {
            const text = state.buffer.slice(1, endMatch + 1)
            output += `${ANSI_DIM}[${ANSI_RESET}${ANSI_CYAN}${text}${ANSI_RESET}${ANSI_DIM}]${ANSI_RESET}`
            state.buffer = state.buffer.slice(endMatch + 2)
            continue
          }
        }

        if (state.buffer.startsWith("<")) {
          const possibleToolNames = [
            "read_file",
            "bash",
            "edit",
            "write",
            "glob",
            "grep",
            "list",
            "webfetch",
            "task",
            "todowrite",
            "todoread",
            "search_files",
            "list_files",
            "list_directory",
            "list_dir",
          ]
          const partialMatch = state.buffer.match(/^<(\w*)/)
          if (partialMatch) {
            const partial = partialMatch[1]
            const couldBeToolCall = possibleToolNames.some((name) => name.startsWith(partial))
            if (couldBeToolCall && !state.buffer.includes(">")) {
              break
            }
          }
        }

        const char = state.buffer[0]
        output += char
        state.buffer = state.buffer.slice(1)
        state.lineStart = char === "\n"
      } else {
        const codeBlockEnd = state.buffer.match(/^```/)
        if (codeBlockEnd) {
          state.inCodeBlock = false
          const language = state.codeBlockLanguage || "code"
          output += formatCodeBlock(state.codeBlockLines, language)
          state.codeBlockLines = []
          state.codeBlockLanguage = ""
          state.buffer = state.buffer.slice(3)
          continue
        }

        const lineMatch = state.buffer.match(/^([^\n]*)\n/)
        if (lineMatch) {
          state.codeBlockLines.push(lineMatch[1])
          state.buffer = state.buffer.slice(lineMatch[0].length)
          continue
        }

        if (!state.buffer.includes("\n") && !state.buffer.includes("```")) {
          break
        }

        output += state.buffer[0]
        state.buffer = state.buffer.slice(1)
      }
    }

    return output
  }

  export function flush(state: State): string {
    const remaining = state.buffer
    state.buffer = ""
    if (state.inCodeBlock && state.codeBlockLines.length > 0) {
      const language = state.codeBlockLanguage || "code"
      return formatCodeBlock(state.codeBlockLines, language) + remaining
    }
    return remaining
  }

  function formatCodeBlock(lines: string[], language: string): string {
    const maxLineNumWidth = String(lines.length).length
    const languageIcon = getLanguageIcon(language)

    let output = `\n${ANSI_CYAN}${ANSI_BOLD}${languageIcon} ${language || "code"}${ANSI_RESET}\n`
    output += `${ANSI_DIM}${"─".repeat(60)}${ANSI_RESET}\n`

    for (let i = 0; i < lines.length; i++) {
      const lineNum = String(i + 1).padStart(maxLineNumWidth, " ")
      const formatted = formatCodeLine(lines[i], language)
      output += `${ANSI_DIM}${lineNum}${ANSI_RESET} ${ANSI_DIM}│${ANSI_RESET} ${formatted}\n`
    }

    output += `${ANSI_DIM}${"─".repeat(60)}${ANSI_RESET}\n`
    return output
  }

  function getLanguageIcon(language: string): string {
    const icons: Record<string, string> = {
      typescript: "⚡",
      javascript: "⚡",
      ts: "⚡",
      js: "⚡",
      python: "🐍",
      py: "🐍",
      rust: "🦀",
      rs: "🦀",
      go: "🐹",
      java: "☕",
      cpp: "⚙️",
      c: "⚙️",
      bash: "🐚",
      sh: "🐚",
      json: "📦",
      yaml: "📋",
      yml: "📋",
      markdown: "📝",
      md: "📝",
      html: "🌐",
      css: "🎨",
      sql: "🗄️",
      docker: "🐳",
      dockerfile: "🐳",
    }
    return icons[language.toLowerCase()] || "📄"
  }

  function formatCodeLine(line: string, language: string): string {
    line = line.replace(/(\/\/.*$)/g, `${ANSI_GRAY}$1${ANSI_RESET}`)
    line = line.replace(/(\/\*[\s\S]*?\*\/)/g, `${ANSI_GRAY}$1${ANSI_RESET}`)
    line = line.replace(/(#.*$)/g, `${ANSI_GRAY}$1${ANSI_RESET}`)

    line = line.replace(
      /(\b(?:import|export|from|const|let|var|function|class|interface|type|enum|namespace|module|extends|implements|public|private|protected|static|readonly|abstract|new|this|super)\b)/g,
      `${ANSI_MAGENTA}$1${ANSI_RESET}`,
    )

    line = line.replace(
      /(\b(?:return|if|else|switch|case|default|break|continue|for|while|do|try|catch|finally|throw|async|await|yield|in|of|typeof|instanceof|void|delete)\b)/g,
      `${ANSI_BLUE}$1${ANSI_RESET}`,
    )

    line = line.replace(/(\b(?:true|false|null|undefined|NaN|Infinity)\b)/g, `${ANSI_YELLOW}$1${ANSI_RESET}`)

    line = line.replace(/(["'`])((?:\\.|(?!\1).)*?)\1/g, `${ANSI_GREEN}$1$2$1${ANSI_RESET}`)

    line = line.replace(/(\b\d+\.?\d*(?:e[+-]?\d+)?\b)/gi, `${ANSI_CYAN}$1${ANSI_RESET}`)

    line = line.replace(/(\b[A-Z][a-zA-Z0-9]*)\b/g, `${ANSI_CYAN}${ANSI_BOLD}$1${ANSI_RESET}`)

    line = line.replace(/([{}[\]().,;:])/g, `${ANSI_DIM}$1${ANSI_RESET}`)

    return line
  }
}

export namespace Executor {
  /**
   * Execute a single task
   */
  export async function executeTask(params: { workflowID: string; taskID: string }): Promise<void> {
    const { workflowID, taskID } = params

    log.info("Executing task", { workflowID, taskID })
    console.log(`\n🔄 Executing task: ${taskID}`)

    const workflow = await Orchestrator.getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    const task = workflow.tasks.find((t) => t.id === taskID)
    if (!task) {
      throw new Error(`Task ${taskID} not found`)
    }

    console.log(`📋 Task: ${task.title}`)
    console.log(`📝 Description: ${task.description}`)
    console.log(`🎯 Stage: ${task.stage}`)
    console.log(`⏱️  Estimated time: ${task.estimatedTime} minutes`)

    // Get the appropriate agent for this stage
    const agentConfig = getAgentForStage(task.stage)
    if (!agentConfig) {
      throw new Error(`No agent found for stage ${task.stage}`)
    }

    console.log(`🤖 Agent: ${agentConfig.name}`)

    // Start the task
    await Orchestrator.startTask({
      workflowID,
      taskID,
      agentID: agentConfig.name,
    })

    try {
      // Get the AI model
      const model = await getModelForAgent(agentConfig)
      console.log(`🧠 Using AI model for task execution`)

      // Build the task execution prompt
      const prompt = buildTaskPrompt(workflow, task, agentConfig)

      log.info("Running agent for task", {
        workflowID,
        taskID,
        agent: agentConfig.name,
        stage: task.stage,
        promptLength: prompt.length,
      })

      console.log(`📨 Sending prompt to AI (${prompt.length} chars)`)
      console.log(`🔸 Prompt preview: ${prompt.substring(0, 200)}...`)

      console.log(`⏳ Streaming AI response...\n`)
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

      const stream = streamText({
        model,
        prompt,
        temperature: agentConfig.temperature ?? 0.5,
      })

      let fullText = ""
      const formatter = StreamFormatter.create()
      let toolCallCount = 0
      let toolCallErrors = 0

      for await (const chunk of stream.fullStream) {
        switch (chunk.type) {
          case "text-delta":
            const formatted = StreamFormatter.format(formatter, chunk.text)
            process.stdout.write(formatted)
            fullText += chunk.text
            break

          case "tool-call":
            toolCallCount++
            const remaining = StreamFormatter.flush(formatter)
            if (remaining) {
              process.stdout.write(remaining)
            }
            const hasError = "error" in chunk && chunk.error
            const boxColor = hasError ? ANSI_RED : ANSI_CYAN
            const statusIcon = hasError ? "❌" : "🔧"

            console.log(`\n${boxColor}${ANSI_BOLD}╭${"─".repeat(58)}╮${ANSI_RESET}`)
            console.log(
              `${boxColor}${ANSI_BOLD}│${ANSI_RESET} ${statusIcon} ${boxColor}${ANSI_BOLD}Tool Call #${toolCallCount}${" ".repeat(58 - 14 - String(toolCallCount).length)}${boxColor}${ANSI_BOLD}│${ANSI_RESET}`,
            )
            console.log(`${boxColor}${ANSI_BOLD}├${"─".repeat(58)}┤${ANSI_RESET}`)
            console.log(
              `${boxColor}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_YELLOW}Tool:${ANSI_RESET} ${boxColor}${ANSI_BOLD}${chunk.toolName}${" ".repeat(58 - 7 - chunk.toolName.length)}${boxColor}${ANSI_BOLD}│${ANSI_RESET}`,
            )
            const toolArgs = "args" in chunk ? chunk.args : chunk.input
            const argsStr = JSON.stringify(toolArgs, null, 2)
            const argsLines = argsStr.split("\n")
            console.log(
              `${boxColor}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_YELLOW}Args:${" ".repeat(58 - 6)}${boxColor}${ANSI_BOLD}│${ANSI_RESET}`,
            )
            for (const line of argsLines) {
              const displayLine = line.length > 56 ? line.slice(0, 53) + "..." : line
              console.log(
                `${boxColor}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_GREEN}${displayLine}${" ".repeat(58 - displayLine.length)}${boxColor}${ANSI_BOLD}│${ANSI_RESET}`,
              )
            }
            if (hasError) {
              toolCallErrors++
              console.log(`${boxColor}${ANSI_BOLD}├${"─".repeat(58)}┤${ANSI_RESET}`)
              console.log(
                `${boxColor}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_RED}Error: ${chunk.error}${" ".repeat(58 - 8 - String(chunk.error).length)}${boxColor}${ANSI_BOLD}│${ANSI_RESET}`,
              )
            }
            console.log(`${boxColor}${ANSI_BOLD}╰${"─".repeat(58)}╯${ANSI_RESET}\n`)
            break

          case "tool-result":
            console.log(`${ANSI_MAGENTA}${ANSI_BOLD}╭${"─".repeat(58)}╮${ANSI_RESET}`)
            console.log(
              `${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET} ✅ ${ANSI_MAGENTA}${ANSI_BOLD}Tool Result${" ".repeat(58 - 13)}${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET}`,
            )
            console.log(`${ANSI_MAGENTA}${ANSI_BOLD}├${"─".repeat(58)}┤${ANSI_RESET}`)
            const toolResult = "result" in chunk ? chunk.result : chunk.output
            const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2)
            const resultLines = resultStr.split("\n").slice(0, 10)
            for (const line of resultLines) {
              const displayLine = line.length > 56 ? line.slice(0, 53) + "..." : line
              console.log(
                `${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_DIM}${displayLine}${" ".repeat(58 - displayLine.length)}${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET}`,
              )
            }
            if (resultStr.split("\n").length > 10) {
              console.log(
                `${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_DIM}... (truncated)${" ".repeat(58 - 16)}${ANSI_MAGENTA}${ANSI_BOLD}│${ANSI_RESET}`,
              )
            }
            console.log(`${ANSI_MAGENTA}${ANSI_BOLD}╰${"─".repeat(58)}╯${ANSI_RESET}\n`)
            break

          case "error":
            console.log(`\n${ANSI_RED}${ANSI_BOLD}╭${"─".repeat(58)}╮${ANSI_RESET}`)
            console.log(
              `${ANSI_RED}${ANSI_BOLD}│${ANSI_RESET} ⚠️  ${ANSI_RED}${ANSI_BOLD}Stream Error${" ".repeat(58 - 14)}${ANSI_RED}${ANSI_BOLD}│${ANSI_RESET}`,
            )
            console.log(`${ANSI_RED}${ANSI_BOLD}├${"─".repeat(58)}┤${ANSI_RESET}`)
            const errorMsg = String(chunk.error)
            const errorLines = errorMsg.split("\n").slice(0, 5)
            for (const line of errorLines) {
              const displayLine = line.length > 56 ? line.slice(0, 53) + "..." : line
              console.log(
                `${ANSI_RED}${ANSI_BOLD}│${ANSI_RESET} ${ANSI_RED}${displayLine}${" ".repeat(58 - displayLine.length)}${ANSI_RED}${ANSI_BOLD}│${ANSI_RESET}`,
              )
            }
            console.log(`${ANSI_RED}${ANSI_BOLD}╰${"─".repeat(58)}╯${ANSI_RESET}\n`)
            break

          case "finish":
            const finalRemaining = StreamFormatter.flush(formatter)
            if (finalRemaining) {
              process.stdout.write(finalRemaining)
            }
            break
        }
      }

      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

      if (toolCallCount > 0) {
        console.log(`${ANSI_CYAN}${ANSI_BOLD}📊 Tool Call Summary${ANSI_RESET}`)
        console.log(`   Total calls: ${ANSI_CYAN}${toolCallCount}${ANSI_RESET}`)
        if (toolCallErrors > 0) {
          console.log(`   Errors: ${ANSI_RED}${toolCallErrors}${ANSI_RESET}`)
        }
        console.log()
      }

      const result = await stream

      log.info("Task execution completed", {
        workflowID,
        taskID,
        usage: result.usage,
        outputLength: fullText.length,
      })

      console.log(`✅ Streaming completed (${fullText.length} chars)`)
      console.log(`📊 Token usage: ${JSON.stringify(result.usage)}`)

      // Mark task as completed
      await Orchestrator.completeTask({
        workflowID,
        taskID,
        success: true,
        metadata: {
          agentID: agentConfig.name,
          outputLength: fullText.length,
          usage: result.usage,
        },
      })

      log.info("Task marked as completed", { workflowID, taskID })
      console.log(`✨ Task completed successfully\n`)
    } catch (error) {
      log.error("Task execution failed", {
        workflowID,
        taskID,
        error,
      })

      console.log(`❌ Task execution failed: ${error instanceof Error ? error.message : String(error)}`)

      // Mark task as failed
      await Orchestrator.completeTask({
        workflowID,
        taskID,
        success: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })

      throw error
    }
  }

  /**
   * Process all pending tasks in the current stage
   */
  export async function processPendingTasks(workflowID: string): Promise<void> {
    log.info("Processing pending tasks", { workflowID })
    console.log(`\n🔍 Checking for pending tasks...`)

    const workflow = await Orchestrator.getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    if (workflow.status !== "running") {
      log.info("Workflow not running, skipping", {
        workflowID,
        status: workflow.status,
      })
      console.log(`⏸️  Workflow status is '${workflow.status}', skipping task processing`)
      return
    }

    // Get pending tasks in current stage
    const pendingTasks = workflow.tasks.filter((t) => t.stage === workflow.currentStage && t.status === "pending")

    console.log(`📊 Found ${pendingTasks.length} pending tasks in stage '${workflow.currentStage}'`)

    if (pendingTasks.length === 0) {
      log.info("No pending tasks in current stage", {
        workflowID,
        stage: workflow.currentStage,
      })

      // Check if stage is complete and can progress
      const stageTasks = workflow.tasks.filter((t) => t.stage === workflow.currentStage)
      const incompleteTasks = stageTasks.filter((t) => t.status !== "completed" && t.status !== "skipped")

      console.log(
        `📈 Stage progress: ${stageTasks.length - incompleteTasks.length}/${stageTasks.length} tasks completed`,
      )

      if (incompleteTasks.length === 0) {
        log.info("Stage complete, progressing to next stage", {
          workflowID,
          stage: workflow.currentStage,
        })
        console.log(`🎉 Stage '${workflow.currentStage}' complete! Progressing to next stage...`)
        await Orchestrator.progressStage(workflowID)
      }

      return
    }

    // Execute tasks sequentially (can be made parallel later)
    for (const task of pendingTasks) {
      // Check if dependencies are met
      if (!areDependenciesMet(task, workflow)) {
        log.info("Task dependencies not met, skipping", {
          workflowID,
          taskID: task.id,
          dependencies: task.dependencies,
        })
        console.log(`⏭️  Skipping task '${task.title}' - dependencies not met: [${task.dependencies.join(", ")}]`)
        continue
      }

      console.log(`▶️  Starting task '${task.title}'`)
      await executeTask({
        workflowID,
        taskID: task.id,
      })
    }
  }

  /**
   * Continuous execution loop for a workflow
   */
  export async function runWorkflow(workflowID: string): Promise<void> {
    log.info("Starting workflow execution loop", { workflowID })
    console.log(`\n🚀 Starting workflow execution loop`)
    console.log(`📍 Workflow ID: ${workflowID}`)

    let iteration = 0
    const maxIterations = 1000 // Safety limit

    while (iteration < maxIterations) {
      iteration++

      log.info("Workflow iteration", { workflowID, iteration })
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      console.log(`🔁 Iteration ${iteration}`)

      const workflow = await Orchestrator.getWorkflow(workflowID)
      if (!workflow) {
        throw new Error(`Workflow ${workflowID} not found`)
      }

      console.log(`📊 Status: ${workflow.status}, Stage: ${workflow.currentStage}`)

      if (workflow.status === "completed") {
        log.info("Workflow completed", { workflowID })
        console.log(`✅ Workflow completed!`)
        break
      }

      if (workflow.status === "failed") {
        log.info("Workflow failed", { workflowID })
        console.log(`❌ Workflow failed!`)
        break
      }

      if (workflow.status === "paused") {
        log.info("Workflow paused", { workflowID })
        console.log(`⏸️  Workflow paused!`)
        break
      }

      // Process pending tasks
      await processPendingTasks(workflowID)

      // Small delay between iterations
      console.log(`⏱️  Waiting 1 second before next iteration...`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    if (iteration >= maxIterations) {
      log.error("Workflow execution reached max iterations", { workflowID })
      console.log(`❌ Workflow execution reached max iterations (${maxIterations})`)
      throw new Error("Workflow execution timeout")
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`🏁 Workflow execution finished after ${iteration} iterations`)
  }

  /**
   * Check if task dependencies are met
   */
  function areDependenciesMet(task: Task, workflow: WorkflowInstance): boolean {
    for (const depTitle of task.dependencies) {
      const depTask = workflow.tasks.find((t) => t.title === depTitle)
      if (!depTask) {
        log.warn("Dependency task not found", {
          taskID: task.id,
          dependency: depTitle,
        })
        continue
      }

      if (depTask.status !== "completed" && depTask.status !== "skipped") {
        return false
      }
    }

    return true
  }

  /**
   * Build the task execution prompt
   */
  function buildTaskPrompt(
    workflow: WorkflowInstance,
    task: Task,
    agentConfig: { name: string; prompt?: string },
  ): string {
    const workspace = `Workspace: ${workflow.workspaceID}`
    const context = `
Workflow: ${workflow.title}
${workflow.description}

Current Stage: ${workflow.currentStage}

Task to Execute:
Title: ${task.title}
Description: ${task.description}
Estimated Time: ${task.estimatedTime} minutes
Priority: ${task.priority}

${task.metadata?.files ? `Files to modify:\n${task.metadata.files.map((f: string) => `- ${f}`).join("\n")}` : ""}
${task.metadata?.risks ? `\nPotential risks:\n${task.metadata.risks.map((r: string) => `- ${r}`).join("\n")}` : ""}

Dependencies:
${task.dependencies.length > 0 ? task.dependencies.map((d) => `- ${d}`).join("\n") : "None"}

Original PRD:
${workflow.prd}
`

    const agentPrompt = agentConfig.prompt || ""

    return `${agentPrompt}

${workspace}

${context}

Please execute this task according to the description and requirements. Focus on completing the specific task at hand.
`
  }

  /**
   * Get the AI model for an agent
   */
  async function getModelForAgent(agentConfig: { model?: { providerID: string; modelID: string } }) {
    if (agentConfig.model) {
      const result = await Provider.getModel(agentConfig.model.providerID, agentConfig.model.modelID)
      return result.language
    }

    // Use default model
    const defaultModel = await Provider.defaultModel()
    const result = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    return result.language
  }
}
