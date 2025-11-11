import type { Component } from "solid-js"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { CommandMenu } from "./CommandMenu"
import { StyledDialog } from "./Dialog"
import { SessionPicker, type Session } from "./SessionPicker"
import { Autocomplete, type AutocompleteItem } from "./Autocomplete"
import { useSDK } from "../context/sdk"

interface MainScreenProps {
  onSubmit: (text: string) => void
  sessions?: Array<{ id: string; title: string; timestamp?: number }>
  onSelectSession?: (id: string) => void
  onNewSession?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
  onToggleBothSidebars?: () => void
  onSwitchModel?: () => void
  onSwitchAgent?: () => void
  projectPath?: string
}

export const MainScreen: Component<MainScreenProps> = (props) => {
  console.log("[MainScreen] RENDERING MAIN SCREEN")
  const [inputText, setInputText] = createSignal("")
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [cursorPosition, setCursorPosition] = createSignal(0)
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false)
  const [sessionPickerOpen, setSessionPickerOpen] = createSignal(false)
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

  // Global keyboard handler for Ctrl+P
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setCommandMenuOpen(true)
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeyDown)
  })

  onCleanup(() => {
    clearInterval(blinkInterval)
    window.removeEventListener("keydown", handleGlobalKeyDown)
  })

  const handleSubmit = () => {
    const text = inputText().trim()
    if (text) {
      props.onSubmit(text)
      setInputText("")
      setAutocompleteOpen(false)
    }
  }

  const examplePrompts = [
    "Help me understand this codebase",
    "Add a new feature to my app",
    "Fix bugs in my tests",
    "Refactor this component",
  ]

  // Slash commands
  const slashCommands: AutocompleteItem[] = [
    { id: "clear", label: "/clear", description: "Clear the screen", type: "command" },
    { id: "help", label: "/help", description: "Show help information", type: "command" },
    { id: "new", label: "/new", description: "Start a new session", type: "command" },
    { id: "switch", label: "/switch", description: "Switch to another session", type: "command" },
  ]

  // Detect autocomplete trigger and update items
  const updateAutocomplete = async (text: string, cursor: number) => {
    const beforeCursor = text.slice(0, cursor)

    // Check for @ (file picker)
    const atMatch = beforeCursor.match(/@([^\s]*)$/)
    if (atMatch && atMatch[1] !== undefined) {
      setAutocompleteType("file")
      setAutocompleteStart(cursor - atMatch[1].length)
      const query = atMatch[1]
      await loadFiles(query)
      calculateAutocompletePosition()
      return
    }

    // Check for / at start (slash commands)
    const slashMatch = beforeCursor.match(/^\/([^\s]*)$/)
    if (slashMatch && slashMatch[1] !== undefined) {
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

    setAutocompleteOpen(false)
  }

  // Load files from server
  const loadFiles = async (query: string) => {
    if (!sdk?.client?.file) {
      console.warn("SDK client not available")
      setAutocompleteOpen(false)
      return
    }

    try {
      const path = props.projectPath || "."
      const result = await sdk.client.file.list({
        query: { path, directory: query || undefined },
      })

      if (result.data && Array.isArray(result.data)) {
        const items: AutocompleteItem[] = result.data.map((entry: any) => ({
          id: entry.path || entry.name,
          label: entry.name,
          description: entry.path,
          type: entry.type === "directory" ? "directory" : "file",
        }))
        setAutocompleteItems(items)
        setAutocompleteIndex(0)
        setAutocompleteOpen(items.length > 0)
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

    // Position at prompt location with offset
    const xOffset = 50 // Account for prompt symbol

    setAutocompletePosition({
      x: rect.left + xOffset,
      y: rect.top - 320, // Above input (dropdown height ~300px + margin)
    })
  }

  // Handle autocomplete selection
  const selectAutocompleteItem = (item: AutocompleteItem) => {
    const text = inputText()
    const cursor = cursorPosition()
    const start = autocompleteStart()

    let replacement = ""
    if (autocompleteType() === "file") {
      replacement = item.id
      if (item.type === "directory") {
        replacement += "/"
      }
    } else if (autocompleteType() === "command") {
      replacement = item.label
    }

    const newText = text.slice(0, start) + replacement + text.slice(cursor)
    setInputText(newText)
    setCursorPosition(start + replacement.length)
    setAutocompleteOpen(false)

    if (item.type === "directory") {
      setTimeout(() => {
        updateAutocomplete(newText, start + replacement.length)
      }, 100)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
      }}
    >
      {/* Logo Container */}
      <div
        style={{
          "margin-bottom": "4em",
          display: "flex",
          "align-items": "center",
          "flex-direction": "column",
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        }}
      >
        {/* ASCII Logo */}
        <pre
          style={{
            "font-size": "16px",
            "line-height": "1.0",
            margin: "0",
            "text-align": "left",
          }}
        >
          <span style={{ color: "#6a6a6a" }}>{`█▀▀▀ █▀▀█ █▀▀█ █▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`█▀▀▀ █  █ █▀▀█ █▀▀▀`}</span>
          {`\n`}
          <span style={{ color: "#6a6a6a" }}>{`█░░░ █░░█ █░░█ █  `}</span>
          <span style={{ color: "#6a6a6a" }}>{`█░░░ █░░█ █░░█ █▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`▀▀▀█ █  █ █▄▄▀ █▀▀▀`}</span>
          {`\n`}
          <span style={{ color: "#6a6a6a" }}>{`▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀   `}</span>
        </pre>

        {/* Version */}
        <div
          style={{
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "right",
            width: "100%",
            "margin-top": "0.5em",
          }}
        >
          v0.0.0-dev
        </div>
      </div>

      {/* Input Container */}
      <div
        style={{
          width: "min(700px, 80vw)",
          "margin-bottom": "3em",
        }}
      >
        {/* Main Input Box */}
        <div
          ref={inputContainerRef}
          style={{
            background: "#1a1a1a",
            padding: "1.2em 1.5em",
            "border-radius": "4px",
            border: "1px solid #2a2a2a",
            position: "relative",
            "min-height": "3.6em",
            display: "flex",
            "align-items": "center",
          }}
        >
          {/* Accent line on left */}
          <div
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              bottom: "0",
              width: "3px",
              background: "#d19a66",
            }}
          />

          {/* Prompt symbol */}
          <span style={{ color: "#d19a66", "font-weight": "bold", "margin-right": "1ch" }}>{">"}</span>

          {/* Input container with placeholder and text */}
          <span style={{ color: "#ffffff", flex: "1", display: "flex", position: "relative" }}>
            {/* Placeholder behind cursor when empty */}
            {!inputText() && (
              <span
                style={{
                  position: "absolute",
                  left: "0",
                  color: "#6a6a6a",
                  "pointer-events": "none",
                }}
              >
                Ask codesurf anything...
              </span>
            )}

            {/* Input text with cursor */}
            <span style={{ position: "relative", "z-index": "1" }}>
              {inputText().slice(0, cursorPosition())}
              <span style={{ color: cursorVisible() ? "#d19a66" : "transparent" }}>█</span>
              {inputText().slice(cursorPosition())}
            </span>
          </span>

          {/* Hidden textarea for keyboard capture */}
          <textarea
            ref={textareaRef}
            value={inputText()}
            onInput={(e) => {
              const newValue = e.currentTarget.value
              setInputText(newValue)
              const newCursor = e.currentTarget.selectionStart
              setCursorPosition(newCursor)
              updateAutocomplete(newValue, newCursor)
            }}
            onClick={(e) => {
              const newCursor = e.currentTarget.selectionStart
              setCursorPosition(newCursor)
              updateAutocomplete(inputText(), newCursor)
            }}
            onKeyDown={(e) => {
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

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            onKeyUp={(e) => setCursorPosition(e.currentTarget.selectionStart)}
            autofocus
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              width: "100%",
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
              padding: "1.2em 1.5em",
            }}
          />
        </div>

        {/* Hint text below input */}
        <div
          style={{
            "margin-top": "0.6em",
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "center",
          }}
        >
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>@</span> files
          {" · "}
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>/</span> commands
          {" · "}
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>enter</span> to send
          {" · "}
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>shift+enter</span> for new line
        </div>
      </div>

      {/* Example Prompts */}
      <div
        style={{
          width: "min(700px, 80vw)",
        }}
      >
        <div
          style={{
            color: "#858585",
            "font-size": "14px",
            "margin-bottom": "1em",
          }}
        >
          Try these:
        </div>

        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(2, 1fr)",
            gap: "0.8em",
          }}
        >
          {examplePrompts.map((prompt) => (
            <div
              onClick={() => {
                setInputText(prompt)
              }}
              style={{
                background: "#1a1a1a",
                padding: "0.8em 1em",
                "border-radius": "4px",
                border: "none",
                color: "#858585",
                cursor: "pointer",
                transition: "all 0.15s ease",
                "font-size": "14px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2a2a2a"
                e.currentTarget.style.color = "#ffffff"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1a1a1a"
                e.currentTarget.style.color = "#858585"
              }}
            >
              {prompt}
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint - clickable */}
      <div
        onClick={() => setCommandMenuOpen(true)}
        style={{
          position: "fixed",
          bottom: "2em",
          color: "#6a6a6a",
          "font-size": "14px",
          cursor: "pointer",
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ffffff"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#6a6a6a"
        }}
      >
        <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> for commands
      </div>

      {/* Command Menu */}
      <CommandMenu
        isOpen={commandMenuOpen()}
        onClose={() => setCommandMenuOpen(false)}
        hideViewCommands={true}
        sessions={props.sessions}
        onSelectSession={(sessionId) => {
          setCommandMenuOpen(false)
          props.onSelectSession?.(sessionId)
        }}
        onNewSession={() => {
          setCommandMenuOpen(false)
          props.onNewSession?.()
        }}
        onSwitchSession={() => {
          setCommandMenuOpen(false)
          setSessionPickerOpen(true)
        }}
        onSwitchModel={() => {
          setCommandMenuOpen(false)
          props.onSwitchModel?.()
        }}
        onSwitchAgent={() => {
          setCommandMenuOpen(false)
          props.onSwitchAgent?.()
        }}
        onToggleLeftSidebar={() => {}}
        onToggleRightSidebar={() => {}}
        onToggleBothSidebars={() => {}}
      />

      {/* Session Picker */}
      <SessionPicker
        isOpen={sessionPickerOpen()}
        sessions={(props.sessions || []).map((s) => ({
          id: s.id,
          title: s.title,
          timestamp: s.timestamp || Date.now(),
        }))}
        onSelect={(sessionId) => {
          setSessionPickerOpen(false)
          props.onSelectSession?.(sessionId)
        }}
        onClose={() => setSessionPickerOpen(false)}
      />

      {/* Autocomplete dropdown */}
      <Show when={autocompleteOpen()}>
        <Autocomplete
          items={autocompleteItems()}
          selectedIndex={autocompleteIndex()}
          onSelect={selectAutocompleteItem}
          onClose={() => setAutocompleteOpen(false)}
          position={autocompletePosition()}
        />
      </Show>
    </div>
  )
}
