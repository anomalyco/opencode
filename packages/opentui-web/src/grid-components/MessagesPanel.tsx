import type { Component } from "solid-js"
import { For, createSignal, createEffect, createMemo, onMount, onCleanup, Show } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { GridInput } from "./GridInput"
import { TerminalInput } from "./TerminalInput"
import { GridTextWrap, calculateWrappedRows } from "./GridTextWrap"
import { SteeringForm, type SteeringQuestionConfig, type SteeringAnswer } from "../components/SteeringForm"
import { Autocomplete, type AutocompleteItem } from "./Autocomplete"
import { useSDK } from "../context/sdk"
import { SubagentNav } from "./SubagentNav"

interface Message {
  id: string
  role: "user" | "assistant"
  parts: Array<{ type: string; text?: string; name?: string; input?: any; tool?: string; output?: any; state?: any }>
  time?: { created: number; completed?: number }
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
  isProcessing?: boolean
  onJumpToLatest?: () => void
  onScrollContainerRef?: (el: HTMLDivElement | null) => void
  currentModel?: string
  onModelClick?: () => void
  projectPath?: string
  // Subagent navigation props
  parentSessionId?: string
  currentSessionId?: string
  siblingSubagents?: Array<{ id: string; title: string }>
  onNavigate?: (sessionId: string) => void
}

export const MessagesPanel: Component<MessagesPanelProps> = (props) => {
  // Use getters to maintain reactivity for dynamic width/col
  const startCol = () => props.col || 44
  const panelWidth = () => props.width || 74

  // Check if viewing a subagent session
  const isSubagent = () => !!props.parentSessionId && !!props.currentSessionId

  const [expandedTools, setExpandedTools] = createSignal<Set<string>>(new Set())
  const [expandedMessages, setExpandedMessages] = createSignal<Set<string>>(new Set())
  const [promptExpanded, setPromptExpanded] = createSignal(false)
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement>()
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [cursorPosition, setCursorPosition] = createSignal(0)
  const [autocompleteOpen, setAutocompleteOpen] = createSignal(false)
  const [autocompleteItems, setAutocompleteItems] = createSignal<AutocompleteItem[]>([])
  const [autocompleteIndex, setAutocompleteIndex] = createSignal(0)
  const [autocompletePosition, setAutocompletePosition] = createSignal({ x: 0, y: 0 })
  const [autocompleteType, setAutocompleteType] = createSignal<"file" | "command" | null>(null)
  const [autocompleteStart, setAutocompleteStart] = createSignal(0)
  let textareaRef: HTMLTextAreaElement | undefined
  let inputContainerRef: HTMLDivElement | undefined

  const sdk = useSDK()

  // Cursor blink animation
  const blinkInterval = setInterval(() => {
    setCursorVisible((prev) => !prev)
  }, 530)

  onCleanup(() => {
    clearInterval(blinkInterval)
  })

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    const container = scrollContainer()
    if (container && props.messages.length > 0) {
      // Provide ref to parent if callback exists
      props.onScrollContainerRef?.(container)

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

  // Slash commands
  const slashCommands: AutocompleteItem[] = [
    { id: "clear", label: "/clear", description: "Clear the screen", type: "command" },
    { id: "help", label: "/help", description: "Show help information", type: "command" },
    { id: "new", label: "/new", description: "Start a new session", type: "command" },
    { id: "switch", label: "/switch", description: "Switch to another session", type: "command" },
  ]

  // Detect autocomplete trigger and update items
  const updateAutocomplete = async (text: string, cursor: number) => {
    // Find the word/token before cursor
    const beforeCursor = text.slice(0, cursor)
    console.log("[Autocomplete] updateAutocomplete:", { text, cursor, beforeCursor })

    // Check for @ (file picker)
    const atMatch = beforeCursor.match(/@([^\s]*)$/)
    console.log("[Autocomplete] @ match:", atMatch)
    if (atMatch && atMatch[1] !== undefined) {
      console.log("[Autocomplete] Triggering file picker for:", atMatch[1])
      setAutocompleteType("file")
      setAutocompleteStart(cursor - atMatch[1].length)
      const query = atMatch[1]
      await loadFiles(query)
      calculateAutocompletePosition()
      return
    }

    // Check for / at start (slash commands)
    const slashMatch = beforeCursor.match(/^\/([^\s]*)$/)
    console.log("[Autocomplete] / match:", slashMatch)
    if (slashMatch && slashMatch[1] !== undefined) {
      console.log("[Autocomplete] Triggering slash commands for:", slashMatch[1])
      setAutocompleteType("command")
      setAutocompleteStart(0)
      const query = slashMatch[1].toLowerCase()
      const filtered = slashCommands.filter(
        (cmd) => cmd.label.toLowerCase().includes(query) || cmd.description?.toLowerCase().includes(query),
      )
      setAutocompleteItems(filtered)
      setAutocompleteIndex(0)
      setAutocompleteOpen(filtered.length > 0)
      calculateAutocompletePosition()
      return
    }

    // No trigger found, close autocomplete
    setAutocompleteOpen(false)
  }

  // Load files from server
  const loadFiles = async (query: string) => {
    console.log("[Autocomplete] loadFiles called:", query)
    if (!sdk?.client?.file) {
      console.warn("SDK client not available")
      setAutocompleteOpen(false)
      return
    }

    try {
      const path = props.projectPath || "."
      console.log("[Autocomplete] Fetching files from:", path, "query:", query)
      const result = await sdk.client.file.list({
        query: { path, directory: query || undefined },
      })

      console.log("[Autocomplete] File list result:", result.data)
      if (result.data && Array.isArray(result.data)) {
        const items: AutocompleteItem[] = result.data.map((entry: any) => ({
          id: entry.path || entry.name,
          label: entry.name,
          description: entry.path,
          type: entry.type === "directory" ? "directory" : "file",
        }))
        console.log("[Autocomplete] Setting items:", items.length, items)
        setAutocompleteItems(items)
        setAutocompleteIndex(0)
        setAutocompleteOpen(items.length > 0)
        console.log("[Autocomplete] autocompleteOpen set to:", items.length > 0)
      }
    } catch (error) {
      console.error("Failed to load files:", error)
      setAutocompleteOpen(false)
    }
  }

  // Calculate autocomplete dropdown position
  const calculateAutocompletePosition = () => {
    if (!inputContainerRef) return
    const rect = inputContainerRef.getBoundingClientRect()

    // Calculate character width (monospace font)
    const charWidth = 9.6 // Berkeley Mono at 16px

    // Position at the start of input with small offset
    // Left padding (1ch) + prompt ("> ") = ~3ch from container left
    const xOffset = 3 * charWidth

    setAutocompletePosition({
      x: rect.left + xOffset,
      y: rect.top - 320, // Above input (dropdown height ~300px + margin)
    })
  }

  // Handle autocomplete selection
  const selectAutocompleteItem = (item: AutocompleteItem) => {
    const text = props.inputText
    const cursor = cursorPosition()
    const start = autocompleteStart()

    let replacement = ""
    if (autocompleteType() === "file") {
      replacement = item.id // Use full path
      if (item.type === "directory") {
        replacement += "/" // Add trailing slash for directories
      }
    } else if (autocompleteType() === "command") {
      replacement = item.label
    }

    const newText = text.slice(0, start) + replacement + text.slice(cursor)
    props.onInput(newText)
    setCursorPosition(start + replacement.length)
    setAutocompleteOpen(false)

    // Re-trigger autocomplete for directories
    if (item.type === "directory") {
      setTimeout(() => {
        updateAutocomplete(newText, start + replacement.length)
      }, 100)
    }
  }

  // Detect steering question tags in text
  const detectSteeringForms = (
    text: string,
  ): Array<{ config: SteeringQuestionConfig; startIndex: number; endIndex: number }> => {
    const forms: Array<{ config: SteeringQuestionConfig; startIndex: number; endIndex: number }> = []
    const pattern = /<steering-question[^>]*>([\s\S]*?)<\/steering-question>/g
    let match: RegExpMatchArray | null

    while ((match = pattern.exec(text)) !== null) {
      try {
        const configStr = match[1] || "{}"
        const config = JSON.parse(configStr) as SteeringQuestionConfig
        forms.push({
          config,
          startIndex: match.index || 0,
          endIndex: (match.index || 0) + match[0].length,
        })
      } catch (error) {
        console.error("Failed to parse steering form config:", error)
      }
    }

    return forms
  }

  const handleSteeringFormSubmit = (answers: SteeringAnswer[]) => {
    // Format answers as readable text
    const answerText = answers
      .map((a) => {
        const answerValue = Array.isArray(a.answer) ? a.answer.join(", ") : a.answer
        return `${a.questionId}: ${answerValue}`
      })
      .join("\n")

    // Submit answers as a new message
    props.onSubmit?.(`Steering form answers:\n${answerText}`)
  }

  // Create a stable key for messages to prevent unnecessary re-renders
  // Only recalculate when message IDs or their text content actually changes
  const messagesKey = createMemo(() => {
    return props.messages
      .slice(-15)
      .map((m) => {
        const textContent = m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text || "")
          .join("")
        return `${m.id}:${textContent.length}:${m.time?.completed || 0}`
      })
      .join("|")
  })

  // Memoize message rendering to prevent flickering
  // This will only re-render when messagesKey changes (i.e., actual content changes)
  const renderMessages = createMemo(() => {
    // Track messagesKey to establish dependency
    const _key = messagesKey()

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
              "will-change": "auto",
              "backface-visibility": "hidden",
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
          elements.push(<GridText col={4} row={currentRow} text=" img " fg="#000000" bg="#d19a66" bold />)
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
        // Group consecutive tools with the same name
        const groupedTools: Array<{ name: string; tools: any[]; ids: string[] }> = []
        toolParts.forEach((tool: any, toolIdx: number) => {
          const toolName = (tool.tool || "TOOL").toUpperCase().replace("CC_", "")
          const toolId = `${msg.id}-${toolIdx}`

          // Check if we can add to the last group
          const lastGroup = groupedTools[groupedTools.length - 1]
          if (lastGroup && lastGroup.name === toolName) {
            lastGroup.tools.push(tool)
            lastGroup.ids.push(toolId)
          } else {
            groupedTools.push({ name: toolName, tools: [tool], ids: [toolId] })
          }
        })

        groupedTools.forEach((group) => {
          const toolName = group.name
          const toolCount = group.tools.length
          const displayName = toolCount > 1 ? `${toolName}(${toolCount})` : toolName
          const toolId = group.ids[0] || `${msg.id}-unknown` // Use first tool's ID for expansion state
          const tool = group.tools[0] // Use first tool for display
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
          elements.push(<GridText col={6} row={currentRow} text={` ${displayName} `} fg="#000000" bg="#9a9a9a" bold />)

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
              const colAfterBadge = 6 + displayName.length + 3
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
          const text = part.text || ""

          // Check for steering forms in the text
          const steeringForms = detectSteeringForms(text)

          if (steeringForms.length > 0) {
            // Split text into segments with steering forms
            let lastIndex = 0

            steeringForms.forEach((form) => {
              // Render text before the form
              if (form.startIndex > lastIndex) {
                const beforeText = text.substring(lastIndex, form.startIndex)
                const normalizedText = beforeText.replace(/\n\n+/g, "\n")
                const lines = normalizedText.split("\n")

                let inCodeBlock = false
                lines.forEach((line) => {
                  if (line.trim().startsWith("```")) {
                    inCodeBlock = !inCodeBlock
                    return
                  }

                  const maxWidth = panelWidth() - 6
                  const wrappedRows = calculateWrappedRows(line, maxWidth)
                  const textColor = inCodeBlock ? "#6a6a6a" : "#ffffff"
                  elements.push(
                    <GridTextWrap col={4} row={currentRow} text={line} maxWidth={maxWidth} fg={textColor} />,
                  )
                  currentRow += wrappedRows
                })
              }

              // Render the steering form
              elements.push(
                <SteeringForm
                  config={form.config}
                  onSubmit={handleSteeringFormSubmit}
                  row={currentRow}
                  maxWidth={panelWidth()}
                />,
              )

              // Calculate how many rows the form takes (estimate)
              const formRows = 5 + form.config.questions.length * 3 + (form.config.description ? 1 : 0)
              currentRow += formRows

              lastIndex = form.endIndex
            })

            // Render text after the last form
            if (lastIndex < text.length) {
              const afterText = text.substring(lastIndex)
              const normalizedText = afterText.replace(/\n\n+/g, "\n")
              const lines = normalizedText.split("\n")

              let inCodeBlock = false
              lines.forEach((line) => {
                if (line.trim().startsWith("```")) {
                  inCodeBlock = !inCodeBlock
                  return
                }

                const maxWidth = panelWidth() - 6
                const wrappedRows = calculateWrappedRows(line, maxWidth)
                const textColor = inCodeBlock ? "#6a6a6a" : "#ffffff"
                elements.push(<GridTextWrap col={4} row={currentRow} text={line} maxWidth={maxWidth} fg={textColor} />)
                currentRow += wrappedRows
              })
            }
          } else {
            // No steering forms, render text normally
            const normalizedText = text.replace(/\n\n+/g, "\n")
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
          }
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
          elements.push(
            <GridText
              col={4 + agent.length + 1}
              row={currentRow}
              text={model}
              fg="#d19a66"
              style={{ "text-decoration": "underline" }}
            />,
          )
          currentRow++
        }
      }

      // One blank line between messages
      currentRow++
    })

    return elements
  })

  return (
    <GridPanel col={startCol()} row={0} width={panelWidth()} height="100%" bg="#0a0a0a" style={{ overflow: "visible" }}>
      {/* Subagent navigation bar (if in subagent session) */}
      <Show when={isSubagent()}>
        <SubagentNav
          parentSessionId={props.parentSessionId!}
          currentSessionId={props.currentSessionId!}
          siblings={props.siblingSubagents || []}
          onNavigate={props.onNavigate || (() => {})}
          width={panelWidth()}
        />
      </Show>

      {/* Scrollable messages area */}
      <div
        ref={setScrollContainer}
        class="terminal-scrollbar"
        style={{
          position: "absolute",
          top: isSubagent() ? "2.4em" : "0", // Offset by nav bar height when in subagent
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
          // CSS containment to isolate rendering
          contain: "layout style paint",
          // Better subpixel rendering
          "-webkit-font-smoothing": "subpixel-antialiased",
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
          ref={inputContainerRef}
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
          <span style={{ color: "#d19a66", "font-weight": "bold" }}>{">"}</span>
          <span style={{ "margin-left": "1ch", color: "#ffffff", display: "flex" }}>
            {props.inputText.slice(0, cursorPosition())}
            <span style={{ color: cursorVisible() ? "#d19a66" : "transparent" }}>█</span>
            {props.inputText.slice(cursorPosition())}
          </span>

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
            <span>@ files / commands enter send shift+enter newline</span>
          </div>

          {/* Hidden textarea for keyboard capture */}
          <textarea
            ref={textareaRef}
            value={props.inputText}
            onInput={(e) => {
              const newValue = e.currentTarget.value
              props.onInput(newValue)
              const newCursor = e.currentTarget.selectionStart
              setCursorPosition(newCursor)
              updateAutocomplete(newValue, newCursor)
            }}
            onClick={(e) => {
              const newCursor = e.currentTarget.selectionStart
              setCursorPosition(newCursor)
              updateAutocomplete(props.inputText, newCursor)
            }}
            onKeyDown={(e) => {
              // Autocomplete is open - handle navigation
              if (autocompleteOpen()) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setAutocompleteIndex((prev) => Math.min(prev + 1, autocompleteItems().length - 1))
                  return
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setAutocompleteIndex((prev) => Math.max(prev - 1, 0))
                  return
                } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault()
                  const item = autocompleteItems()[autocompleteIndex()]
                  if (item) {
                    selectAutocompleteItem(item)
                  }
                  return
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setAutocompleteOpen(false)
                  return
                }
              }

              // Normal keyboard handling
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if (props.inputText.trim()) {
                  props.onSubmit?.(props.inputText)
                  props.onInput("")
                  setCursorPosition(0)
                }
              }
            }}
            onKeyUp={(e) => {
              const newCursor = e.currentTarget.selectionStart
              setCursorPosition(newCursor)
            }}
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
            "padding-left": "1ch",
            "padding-right": "1ch",
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
          }}
        >
          {/* Left: Model selector */}
          <span style={{ color: "#858585" }}>
            Anthropic{" "}
            <span
              onClick={() => props.onModelClick?.()}
              style={{
                color: "#e5c07b",
                "font-weight": "bold",
                cursor: props.onModelClick ? "pointer" : "default",
              }}
            >
              {props.currentModel || "Claude Sonnet 4.5 (latest)"}
            </span>
          </span>

          {/* Right: Commands and Latest aligned to right edge */}
          <span style={{ color: "#858585", display: "flex", gap: "2ch" }}>
            <span>
              <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> commands
            </span>
            <span
              onClick={() => props.onJumpToLatest?.()}
              style={{
                color: "#d19a66",
                cursor: "pointer",
              }}
            >
              Latest ↓
            </span>
            {props.isProcessing && (
              <span>
                <span style={{ color: "#ffffff", "font-weight": "bold" }}>esc</span>
                {" interrupt"}
              </span>
            )}
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

      {/* Autocomplete dropdown */}
      {(() => {
        console.log("[Autocomplete] Render check:", {
          open: autocompleteOpen(),
          items: autocompleteItems().length,
          position: autocompletePosition(),
        })
        return null
      })()}
      <Show when={autocompleteOpen()}>
        <Autocomplete
          items={autocompleteItems()}
          selectedIndex={autocompleteIndex()}
          onSelect={selectAutocompleteItem}
          onClose={() => setAutocompleteOpen(false)}
          position={autocompletePosition()}
        />
      </Show>
    </GridPanel>
  )
}
