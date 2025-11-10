import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup } from "solid-js"
import { GridText } from "./GridText"

export interface Attachment {
  type: "image" | "file"
  label: string
}

interface TerminalInputProps {
  value: string
  onInput: (value: string) => void
  onSubmit?: (value: string) => void
  width?: number
  placeholder?: string
  showOptions?: boolean
  onToggleOptions?: (expanded: boolean) => void
  attachments?: Attachment[]
}

export const TerminalInput: Component<TerminalInputProps> = (props) => {
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [optionsExpanded, setOptionsExpanded] = createSignal(false)
  let inputRef: HTMLInputElement | undefined
  let cursorInterval: number | undefined

  const panelWidth = props.width || 74

  onMount(() => {
    // Blinking cursor interval (500ms)
    cursorInterval = window.setInterval(() => {
      setCursorVisible((prev) => !prev)
    }, 500)

    // Focus the input
    inputRef?.focus()
  })

  onCleanup(() => {
    if (cursorInterval) {
      clearInterval(cursorInterval)
    }
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    // Tab: Toggle options
    if (e.key === "Tab") {
      e.preventDefault()
      const newExpanded = !optionsExpanded()
      setOptionsExpanded(newExpanded)
      props.onToggleOptions?.(newExpanded)
    }
    // Escape: Close options
    else if (e.key === "Escape") {
      e.preventDefault()
      setOptionsExpanded(false)
      props.onToggleOptions?.(false)
    }
    // Enter: Submit (without Shift)
    else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (props.value.trim()) {
        props.onSubmit?.(props.value)
      }
    }
    // Shift+Enter: Allow newline (default behavior)
    else if (e.key === "Enter" && e.shiftKey) {
      // Allow default behavior - will insert newline
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: "0",
        left: "0",
        right: "0",
        height: optionsExpanded() ? "15em" : "4.5em",
        background: "#0a0a0a",
        "border-top": "1px solid #2a2a2a",
      }}
    >
      {/* Options row (only show when expanded) */}
      {optionsExpanded() && (
        <>
          <GridText col={0} row={0} text="Options:" fg="#6a6a6a" />
          <GridText col={10} row={0} text="[a] Agent" fg="#d4d4d4" />
          <GridText col={22} row={0} text="[m] Model" fg="#d4d4d4" />
          <GridText col={34} row={0} text="[i] Image" fg="#d4d4d4" />
          <GridText col={46} row={0} text="[f] File" fg="#d4d4d4" />

          <GridText col={10} row={1} text="[c] Context" fg="#d4d4d4" />
          <GridText col={24} row={1} text="[t] Tools" fg="#d4d4d4" />
          <GridText col={36} row={1} text="[p] Plugins" fg="#d4d4d4" />
        </>
      )}

      {/* Input area - 2 rows from bottom */}
      <div
        style={{
          position: "absolute",
          bottom: "3em",
          left: "0",
          right: "0",
          height: "1.5em",
          background: "#2a2a2a",
        }}
      >
        {/* Orange prompt character */}
        <GridText col={0} row={0} text=">" fg="#e5c07b" bold />

        {/* Render attachments as badges */}
        {(() => {
          let currentCol = 2
          const elements: any[] = []

          // Render attachments first
          if (props.attachments && props.attachments.length > 0) {
            props.attachments.forEach((attachment) => {
              const badgeText = `[${attachment.label}]`
              elements.push(<GridText col={currentCol} row={0} text={badgeText} fg="#000000" bg="#d19a66" bold />)
              currentCol += badgeText.length + 1 // badge + space
            })
          }

          // Render text input after attachments
          if (props.value) {
            elements.push(<GridText col={currentCol} row={0} text={props.value} fg="#ffffff" />)
            currentCol += props.value.length
          }

          // Render cursor at the end
          if (cursorVisible()) {
            elements.push(<GridText col={currentCol} row={0} text="█" fg="#d19a66" />)
          }

          return elements
        })()}

        {/* Hidden input for capturing keystrokes */}
        <input
          ref={inputRef}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autofocus
          style={{
            position: "absolute",
            left: "2ch",
            top: "0",
            width: `${panelWidth - 4}ch`,
            height: "1.5em",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
            background: "transparent",
            color: "transparent",
            "caret-color": "transparent",
            border: "none",
            outline: "none",
            padding: "0",
            margin: "0",
          }}
        />
      </div>

      {/* Help text - bottom row */}
      <div
        style={{
          position: "absolute",
          bottom: "1.5em",
          left: "0",
          right: "0",
          height: "1.5em",
        }}
      >
        <GridText
          col={0}
          row={0}
          text={optionsExpanded() ? "esc close options" : "tab options"}
          fg="#6a6a6a"
          onClick={() => {
            const newExpanded = !optionsExpanded()
            setOptionsExpanded(newExpanded)
            props.onToggleOptions?.(newExpanded)
          }}
        />
        <GridText col={20} row={0} text="enter send" fg="#6a6a6a" />
        <GridText col={32} row={0} text="shift+enter newline" fg="#6a6a6a" />
      </div>
    </div>
  )
}
