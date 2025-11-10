import type { Component } from "solid-js"
import { For, createSignal, createEffect, onMount, onCleanup } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { GridInput } from "./GridInput"
import { TerminalInput } from "./TerminalInput"

interface Message {
  id: string
  role: "user" | "assistant"
  parts: Array<{ type: string; text?: string; name?: string; input?: any }>
  time?: { created: number }
  agent?: string
  model?: string
}

interface MessagesPanelProps {
  col?: number
  width?: number
  messages: Message[]
  inputText: string
  onInput: (text: string) => void
  onSubmit?: (text: string) => void
}

export const MessagesPanel: Component<MessagesPanelProps> = (props) => {
  // Use getters to maintain reactivity for dynamic width/col
  const startCol = () => props.col || 44
  const panelWidth = () => props.width || 74

  const [expandedTools, setExpandedTools] = createSignal<Set<string>>(new Set())
  const [promptExpanded, setPromptExpanded] = createSignal(false)
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement>()

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    const container = scrollContainer()
    if (container && props.messages.length > 0) {
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
    }
  })

  const toggleTool = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
      } else {
        next.add(toolId)
      }
      return next
    })
  }

  const renderMessages = () => {
    let currentRow = 1
    const elements: any[] = []

    props.messages.slice(-15).forEach((msg) => {
      const isUser = msg.role === "user"
      const toolParts = msg.parts.filter((p) => p.type === "tool_use")
      const textParts = msg.parts.filter((p) => p.type === "text")

      // Empty row above message
      currentRow++

      // USER MESSAGES
      if (isUser) {
        const textStartRow = currentRow
        let contentRows = 0

        // Add blank line with background at start
        elements.push(
          <div
            style={{
              position: "absolute",
              left: "0",
              top: `${currentRow * 1.2}em`,
              width: "100%",
              height: "1.2em",
              background: "#1a1a1a",
            }}
          />,
        )
        currentRow++
        contentRows++

        // Check for image parts
        const imageParts = msg.parts.filter((p) => p.type === "image")

        // Render images with badges and paths
        imageParts.forEach((img: any) => {
          // Background for row
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: "100%",
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          // img badge
          elements.push(<GridText col={2} row={currentRow} text=" img " fg="#000000" bg="#d4a574" bold />)
          // file path
          const path = img.source?.data || img.url || ""
          elements.push(<GridText col={8} row={currentRow} text={path.slice(0, panelWidth() - 10)} fg="#6a6a6a" />)
          currentRow++
          contentRows++
        })

        // Render text content
        if (textParts.length > 0) {
          textParts.forEach((part) => {
            const lines = (part.text || "").split("\n")
            lines.forEach((line) => {
              // Background for entire row
              elements.push(
                <div
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${currentRow * 1.2}em`,
                    width: "100%",
                    height: "1.2em",
                    background: "#1a1a1a",
                  }}
                />,
              )
              // Text content
              elements.push(<GridText col={2} row={currentRow} text={line.slice(0, panelWidth() - 4)} fg="#ffffff" />)
              currentRow++
              contentRows++
            })
          })
        }

        // Username + timestamp (immediately after message text)
        if (msg.time) {
          const time = new Date(msg.time.created * 1000).toLocaleTimeString()
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: "100%",
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          elements.push(<GridText col={2} row={currentRow} text={`jkneen (${time})`} fg="#6a6a6a" />)
          currentRow++
          contentRows++
        }

        // Add blank line at bottom
        elements.push(
          <div
            style={{
              position: "absolute",
              left: "0",
              top: `${currentRow * 1.2}em`,
              width: "100%",
              height: "1.2em",
              background: "#1a1a1a",
            }}
          />,
        )
        currentRow++
        contentRows++

        // Blue bar spanning ALL rows (blank + content + username + blank)
        for (let row = textStartRow; row < currentRow; row++) {
          elements.push(<GridText col={0} row={row} text="▌" fg="#61afef" />)
        }
      }

      // ASSISTANT MESSAGES WITH TOOLS
      if (!isUser && toolParts.length > 0) {
        toolParts.forEach((tool: any, toolIdx: number) => {
          const toolName = (tool.name || "TOOL").toUpperCase().replace("CC_", "")
          const toolId = `${msg.id}-${toolIdx}`
          const toolExpanded = expandedTools().has(toolId)

          // Tool header with arrow and badge
          const arrow = toolExpanded ? "▼" : "▶"
          elements.push(
            <GridText col={0} row={currentRow} text={arrow} fg="#6a6a6a" onClick={() => toggleTool(toolId)} />,
          )
          elements.push(<GridText col={2} row={currentRow} text={` ${toolName} `} fg="#000000" bg="#e5c07b" bold />)

          // Show summary info when collapsed (for certain tools)
          if (!toolExpanded && tool.input) {
            let summary = ""
            if (toolName === "READ" && tool.input.filePath) {
              summary = ` ${tool.input.filePath}`
              if (tool.input.offset || tool.input.limit) {
                summary += ` [offset=${tool.input.offset || 0}, limit=${tool.input.limit || 2000}]`
              }
            } else if (toolName === "EDIT" && tool.input.filePath) {
              summary = ` ${tool.input.filePath}`
            } else if (toolName === "WRITE" && tool.input.filePath) {
              summary = ` ${tool.input.filePath}`
            } else if (toolName === "BASH" && tool.input.command) {
              summary = ` ${tool.input.command.slice(0, 50)}`
            }
            if (summary) {
              const colAfterBadge = 2 + toolName.length + 3
              elements.push(<GridText col={colAfterBadge} row={currentRow} text={summary} fg="#6a6a6a" />)
            }
          }

          currentRow++

          // Tool output (if expanded)
          if (toolExpanded) {
            // Show tool input
            if (tool.input) {
              elements.push(<GridText col={2} row={currentRow} text="Input:" fg="#6a6a6a" />)
              currentRow++

              const inputStr = JSON.stringify(tool.input, null, 2)
              const inputLines = inputStr.split("\n").slice(0, 10)
              inputLines.forEach((line: string) => {
                elements.push(<GridText col={4} row={currentRow} text={line.slice(0, panelWidth() - 6)} fg="#ffffff" />)
                currentRow++
              })
            }

            // Show tool output placeholder
            elements.push(<GridText col={2} row={currentRow} text="Output:" fg="#6a6a6a" />)
            currentRow++
            elements.push(<GridText col={4} row={currentRow} text="[Tool output...]" fg="#6a6a6a" />)
            currentRow++
          }

          currentRow++ // Space after tool block
        })
      }

      // ASSISTANT TEXT RESPONSES (no tools)
      if (!isUser && toolParts.length === 0 && textParts.length > 0) {
        const responseStartRow = currentRow

        // Blank line above
        currentRow++

        // Content lines
        textParts.forEach((part) => {
          const lines = (part.text || "").split("\n")
          lines.forEach((line) => {
            elements.push(<GridText col={2} row={currentRow} text={line.slice(0, panelWidth() - 4)} fg="#ffffff" />)
            currentRow++
          })
        })

        // Blank line below
        currentRow++

        // No bar for assistant messages
      }

      currentRow++ // Empty row below message
    })

    return elements
  }

  return (
    <GridPanel col={startCol()} row={0} width={panelWidth()} height="100%" bg="#0a0a0a">
      {/* Scrollable messages area */}
      <div
        ref={setScrollContainer}
        class="terminal-scrollbar"
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          right: "0",
          bottom: "4.8em", // Model row (1.2em) + Input area (3.6em)
          "overflow-y": "auto",
          "overflow-x": "hidden",
          // GPU acceleration for smooth scrolling
          transform: "translateZ(0)",
          "will-change": "scroll-position",
          // Smooth scroll behavior
          "scroll-behavior": "smooth",
        }}
      >
        {renderMessages()}
      </div>

      {/* Input area at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: "0",
          left: "0",
          right: "0",
          background: "#0a0a0a",
        }}
      >
        {/* Model info row */}
        <div
          style={{
            height: "1.2em",
            background: "#1a1a1a",
            padding: "0 1ch",
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
          }}
        >
          <span>
            <span style={{ color: "#858585" }}>Anthropic </span>
            <span
              style={{
                color: "#ffffff",
                "text-decoration": "underline",
                "text-decoration-color": "#d19a66",
                "text-decoration-thickness": "2px",
                "text-underline-offset": "2px",
              }}
            >
              Claude Sonnet 4.5 (latest)
            </span>
          </span>
          <span style={{ color: "#858585" }}>
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>esc</span> interrupt
          </span>
        </div>

        {/* Input row - 3 lines high */}
        <div
          style={{
            height: "3.6em",
            background: "#2a2a2a",
            padding: "0 1ch",
            display: "flex",
            "align-items": "center",
            position: "relative",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
          }}
        >
          <span style={{ color: "#e5c07b" }}>{">"}</span>
          <span style={{ "margin-left": "1ch", color: "#ffffff" }}>{props.inputText}</span>
          {props.cursorVisible && <span style={{ color: "#d19a66" }}>█</span>}

          {/* Hint text at bottom of input */}
          <div
            style={{
              position: "absolute",
              bottom: "0.2em",
              left: "1ch",
              right: "1ch",
              display: "flex",
              "justify-content": "space-between",
              color: "#6a6a6a",
              "font-size": "14px",
            }}
          >
            <span>tab changes agent</span>
            <span>enter send shift+enter newline</span>
          </div>

          {/* Hidden textarea for keyboard capture */}
          <textarea
            value={props.inputText}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            autofocus
            style={{
              position: "absolute",
              left: "3ch",
              top: "0",
              width: "calc(100% - 4ch)",
              height: "100%",
              background: "transparent",
              color: "transparent",
              "caret-color": "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              "font-family": "inherit",
              "font-size": "inherit",
              "line-height": "inherit",
            }}
          />
        </div>
      </div>
    </GridPanel>
  )
}
