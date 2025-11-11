import type { Component } from "solid-js"
import { For, createSignal, createEffect, onMount, onCleanup } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { GridInput } from "./GridInput"
import { TerminalInput } from "./TerminalInput"
import { GridTextWrap, calculateWrappedRows } from "./GridTextWrap"

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
  const [expandedMessages, setExpandedMessages] = createSignal<Set<string>>(new Set())
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

  const toggleMessage = (msgId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev)
      if (next.has(msgId)) {
        next.delete(msgId)
      } else {
        next.add(msgId)
      }
      return next
    })
  }

  const renderMessages = () => {
    let currentRow = 1
    const elements: any[] = []
    const messages = props.messages.slice(-15)

    messages.forEach((msg, msgIndex) => {
      const isUser = msg.role === "user"
      const isLastMessage = msgIndex === messages.length - 1
      const toolParts = msg.parts.filter((p) => p.type === "tool")
      const textParts = msg.parts.filter((p) => p.type === "text")

      // Empty row above message (only for user messages - tools handle their own spacing)
      if (isUser) {
        currentRow++
      }

      // USER MESSAGES
      if (isUser) {
        const textStartRow = currentRow
        let contentRows = 0
        const bgWidth = `calc(100% - ${2 * 9.6}px)` // 2 char gap on right

        // Add blank line with background at start
        elements.push(
          <div
            style={{
              position: "absolute",
              left: "0",
              top: `${currentRow * 1.2}em`,
              width: bgWidth,
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
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          // img badge
          elements.push(<GridText col={4} row={currentRow} text=" img " fg="#000000" bg="#d4a574" bold />)
          // file path
          const path = img.source?.data || img.url || ""
          elements.push(<GridText col={8} row={currentRow} text={path.slice(0, panelWidth() - 10)} fg="#6a6a6a" />)
          currentRow++
          contentRows++
        })

        // Render text content
        if (textParts.length > 0) {
          textParts.forEach((part) => {
            // Replace multiple newlines with single newline
            const normalizedText = (part.text || "").replace(/\n\n+/g, "\n")
            const lines = normalizedText.split("\n")

            let inCodeBlock = false
            lines.forEach((line) => {
              // Check for code block markers
              if (line.trim().startsWith("```")) {
                inCodeBlock = !inCodeBlock
                // Don't render the ``` line itself
                return
              }

              // Calculate wrapped rows for this line
              const maxWidth = panelWidth() - 6 // 4 char indent (shifted right 2) + 2 char right gap
              const wrappedRows = calculateWrappedRows(line, maxWidth)

              // Add background for all wrapped rows
              for (let i = 0; i < wrappedRows; i++) {
                elements.push(
                  <div
                    style={{
                      position: "absolute",
                      left: "0",
                      top: `${(currentRow + i) * 1.2}em`,
                      width: bgWidth,
                      height: "1.2em",
                      background: "#1a1a1a",
                    }}
                  />,
                )
              }

              // Render code blocks with grey color, normal text with white
              const textColor = inCodeBlock ? "#6a6a6a" : "#ffffff"
              elements.push(<GridTextWrap col={4} row={currentRow} text={line} maxWidth={maxWidth} fg={textColor} />)
              currentRow += wrappedRows
              contentRows += wrappedRows
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
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          elements.push(
            <>
              <GridText col={4} row={currentRow} text="jkneen" fg="#ffffff" />
              <GridText col={11} row={currentRow} text={` (${time})`} fg="#6a6a6a" />
            </>,
          )
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
              width: bgWidth,
              height: "1.2em",
              background: "#1a1a1a",
            }}
          />,
        )
        currentRow++
        contentRows++

        // BLUE bar spanning ALL rows (blank + content + username + blank)
        for (let row = textStartRow; row < currentRow; row++) {
          elements.push(<GridText col={0} row={row} text="▌" fg="#61afef" />)
        }
      }

      // ASSISTANT MESSAGES WITH TOOLS
      if (!isUser && toolParts.length > 0) {
        toolParts.forEach((tool: any, toolIdx: number) => {
          const toolName = (tool.tool || "TOOL").toUpperCase().replace("CC_", "")
          const toolId = `${msg.id}-${toolIdx}`
          const toolExpanded = expandedTools().has(toolId)
          const toolInput = tool.input || tool.state?.input || {}
          const toolOutput = tool.output || tool.state?.output || tool.state?.metadata || {}

          const toolStartRow = currentRow
          const bgWidth = `calc(100% - ${2 * 9.6}px)` // 2 char gap on right

          const toolBlockStartRow = currentRow

          // Blank line above (row 1 of 3)
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          currentRow++

          // Background for content row (row 2 of 3)
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )

          // Tool header with arrow and badge (moved 2 chars right)
          const arrow = toolExpanded ? "▼" : "▶"
          elements.push(
            <GridText col={4} row={currentRow} text={arrow} fg="#6a6a6a" onClick={() => toggleTool(toolId)} />,
          )
          elements.push(<GridText col={6} row={currentRow} text={` ${toolName} `} fg="#000000" bg="#9a9a9a" bold />)

          // Show summary info when collapsed (for certain tools)
          if (!toolExpanded && toolInput) {
            let summary = ""
            if (toolName === "READ" && toolInput.filePath) {
              summary = ` ${toolInput.filePath}`
              if (toolInput.offset || toolInput.limit) {
                summary += ` [offset=${toolInput.offset || 0}, limit=${toolInput.limit || 2000}]`
              }
            } else if (toolName === "EDIT" && toolInput.filePath) {
              summary = ` ${toolInput.filePath}`
            } else if (toolName === "WRITE" && toolInput.filePath) {
              summary = ` ${toolInput.filePath}`
            } else if (toolName === "BASH" && toolInput.command) {
              summary = ` ${toolInput.command.slice(0, 50)}`
            }
            if (summary) {
              const colAfterBadge = 6 + toolName.length + 3
              elements.push(<GridText col={colAfterBadge} row={currentRow} text={summary} fg="#6a6a6a" />)
            }
          }

          currentRow++

          // Blank line below (row 3 of 3) - MINIMUM 3 ROWS FOR TOOL BLOCKS
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )
          currentRow++

          // Tool output (if expanded)
          if (toolExpanded) {
            const bgWidth = `calc(100% - ${2 * 9.6}px)` // 2 char gap on right

            // Show tool input
            if (toolInput && Object.keys(toolInput).length > 0) {
              // Background for Input: label row
              elements.push(
                <div
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${currentRow * 1.2}em`,
                    width: bgWidth,
                    height: "1.2em",
                    background: "#1a1a1a",
                  }}
                />,
              )
              elements.push(<GridText col={4} row={currentRow} text="Input:" fg="#6a6a6a" />)
              currentRow++

              const inputStr = JSON.stringify(toolInput, null, 2)
              const inputLines = inputStr.split("\n").slice(0, 20)
              inputLines.forEach((line: string) => {
                // Background for each input line
                elements.push(
                  <div
                    style={{
                      position: "absolute",
                      left: "0",
                      top: `${currentRow * 1.2}em`,
                      width: bgWidth,
                      height: "1.2em",
                      background: "#1a1a1a",
                    }}
                  />,
                )
                elements.push(<GridText col={6} row={currentRow} text={line.slice(0, panelWidth() - 8)} fg="#6a6a6a" />)
                currentRow++
              })
              // Blank line with background
              elements.push(
                <div
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${currentRow * 1.2}em`,
                    width: bgWidth,
                    height: "1.2em",
                    background: "#1a1a1a",
                  }}
                />,
              )
              currentRow++
            }

            // Show tool output
            if (toolOutput && Object.keys(toolOutput).length > 0) {
              // Background for Output: label row
              elements.push(
                <div
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${currentRow * 1.2}em`,
                    width: bgWidth,
                    height: "1.2em",
                    background: "#1a1a1a",
                  }}
                />,
              )
              elements.push(<GridText col={4} row={currentRow} text="Output:" fg="#6a6a6a" />)
              currentRow++

              const outputStr = JSON.stringify(toolOutput, null, 2)
              const outputLines = outputStr.split("\n").slice(0, 20)
              outputLines.forEach((line: string) => {
                // Background for each output line
                elements.push(
                  <div
                    style={{
                      position: "absolute",
                      left: "0",
                      top: `${currentRow * 1.2}em`,
                      width: bgWidth,
                      height: "1.2em",
                      background: "#1a1a1a",
                    }}
                  />,
                )
                elements.push(<GridText col={6} row={currentRow} text={line.slice(0, panelWidth() - 8)} fg="#6a6a6a" />)
                currentRow++
              })
            } else {
              // Background for pending output
              elements.push(
                <div
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${currentRow * 1.2}em`,
                    width: bgWidth,
                    height: "1.2em",
                    background: "#1a1a1a",
                  }}
                />,
              )
              elements.push(<GridText col={4} row={currentRow} text="Output: (pending)" fg="#6a6a6a" />)
              currentRow++
            }

            // Add blank grey line at bottom of expanded tool content
            elements.push(
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  top: `${currentRow * 1.2}em`,
                  width: bgWidth,
                  height: "1.2em",
                  background: "#1a1a1a",
                }}
              />,
            )
            currentRow++
          }

          const toolBlockEndRow = currentRow

          // Vertical "cut" line - background color creates gap in tool block (rendered after expanded content)
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "calc(1ch - 6px)",
                top: `${toolBlockStartRow * 1.2}em`,
                width: "3px",
                height: `${(toolBlockEndRow - toolBlockStartRow) * 1.2}em`,
                background: "#0a0a0a",
                "z-index": "10",
              }}
            />,
          )

          // No extra space after tool block - the 3rd row is already a blank line
        })
      }

      // ASSISTANT TEXT RESPONSES - Show text whether there are tools or not
      if (!isUser && textParts.length > 0) {
        // Always add 1 blank line before text (whether tools exist or not)
        currentRow++

        const responseStartRow = currentRow

        // Content lines
        textParts.forEach((part) => {
          // Replace multiple newlines with single newline
          const normalizedText = (part.text || "").replace(/\n\n+/g, "\n")
          const lines = normalizedText.split("\n")

          let inCodeBlock = false
          lines.forEach((line) => {
            // Check for code block markers
            if (line.trim().startsWith("```")) {
              inCodeBlock = !inCodeBlock
              // Don't render the ``` line itself
              return
            }

            // Calculate wrapped rows for this line
            const maxWidth = panelWidth() - 6 // 4 char indent (shifted right 2) + 2 char right gap
            const wrappedRows = calculateWrappedRows(line, maxWidth)

            // Render code blocks with grey color, normal text with white
            const textColor = inCodeBlock ? "#6a6a6a" : "#ffffff"
            elements.push(<GridTextWrap col={4} row={currentRow} text={line} maxWidth={maxWidth} fg={textColor} />)
            currentRow += wrappedRows
          })
        })

        // Orange bar spanning all rows (blank + content + blank) - COMMENTED OUT
        // for (let row = responseStartRow; row < currentRow; row++) {
        //   elements.push(<GridText col={0} row={row} text="▌" fg="#d19a66" />)
        // }

        // Attribution line ONLY on last message if completed
        if (isLastMessage && msg.time?.completed) {
          // One blank line above attribution
          currentRow++

          const agent = msg.agent || "General"
          const model = msg.model || "claude-sonnet-4-5"
          elements.push(<GridText col={4} row={currentRow} text={agent} fg="#569cd6" bold />)
          elements.push(<GridText col={4 + agent.length + 1} row={currentRow} text={model} fg="#6a6a6a" />)
          currentRow++
        }
      }

      // One blank line between messages
      currentRow++
    })

    return elements
  }

  return (
    <GridPanel col={startCol()} row={0} width={panelWidth()} height="100%" bg="#0a0a0a" style={{ overflow: "visible" }}>
      {/* Scrollable messages area */}
      <div
        ref={setScrollContainer}
        class="terminal-scrollbar"
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          right: "0",
          bottom: "7.2em", // Blank (1.2em) + Input (3.6em) + Model (1.2em) + Blank (1.2em)
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
        {/* Blank line above prompt */}
        <div
          style={{
            height: "1.2em",
            background: "#0a0a0a",
          }}
        />

        {/* Input row - 3 lines high */}
        <div
          style={{
            height: "3.6em",
            background: "#1a1a1a",
            padding: "0 1ch",
            display: "flex",
            "align-items": "center",
            position: "relative",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
            border: "none",
          }}
        >
          {/* Left side: Grey accent line */}
          <div
            style={{
              position: "absolute",
              left: "calc(1ch - 10px)",
              top: "0",
              bottom: "0",
              width: "4px",
              background: "#6a6a6a",
              "z-index": "10",
            }}
          />
          {/* Left side: Black "cut" line immediately right of grey line */}
          <div
            style={{
              position: "absolute",
              left: "calc(1ch - 6px)",
              top: "0",
              bottom: "0",
              width: "3px",
              background: "#0a0a0a",
              "z-index": "10",
            }}
          />

          {/* Right side: Grey accent line - aligned with divider */}
          <div
            style={{
              position: "absolute",
              right: "-7px",
              top: "0",
              bottom: "0",
              width: "4px",
              background: "#6a6a6a",
              "z-index": "10",
            }}
          />
          {/* Right side: Black "cut" line */}
          <div
            style={{
              position: "absolute",
              right: "-4px",
              top: "0",
              bottom: "0",
              width: "3px",
              background: "#0a0a0a",
              "z-index": "10",
            }}
          />

          <span style={{ "margin-left": "1ch" }}></span>
          <span style={{ color: "#e5c07b", "font-weight": "bold" }}>{">"}</span>
          <span style={{ "margin-left": "1ch", color: "#ffffff" }}>{props.inputText}</span>
          {props.cursorVisible && <span style={{ color: "#d19a66" }}>█</span>}

          {/* Hint text at bottom of input */}
          <div
            style={{
              position: "absolute",
              bottom: "0.2em",
              right: "1ch",
              color: "#6a6a6a",
              "font-size": "14px",
            }}
          >
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

        {/* Model info row - DIRECTLY UNDER the prompt, NO GAP */}
        <div
          style={{
            height: "1.2em",
            background: "#0a0a0a",
            padding: "0",
            "padding-left": "0",
            "padding-right": "1ch",
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
                color: "#ff9800",
                "text-decoration": "underline",
                "text-decoration-color": "#ff9800",
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

        {/* Blank line below model row */}
        <div
          style={{
            height: "1.2em",
            background: "#0a0a0a",
          }}
        />
      </div>
    </GridPanel>
  )
}
