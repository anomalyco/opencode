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
  const [inputHeight, setInputHeight] = createSignal(2) // Start at 2 lines
  let inputRef: HTMLTextAreaElement | undefined
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

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    props.onInput(e.currentTarget.value)

    // Auto-grow textarea based on content
    const textarea = e.currentTarget
    const lineCount = textarea.value.split("\n").length
    setInputHeight(Math.max(2, lineCount)) // Minimum 2 lines
  }

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
    // Shift+Enter: Allow newline (default behavior will add \n)
  }

  const containerHeight = () => {
    if (optionsExpanded()) return "15em"
    // 1.5em per line + 3em for help text
    return `${inputHeight() * 1.5 + 3}em`
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: "0",
        left: "0",
        right: "0",
        height: containerHeight(),
        background: "#0a0a0a",
        "border-top": "1px solid #2a2a2a",
        "margin-bottom": "5px",
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

      {/* Input area - grows with content */}
      <div
        style={{
          position: "absolute",
          bottom: "3em",
          left: "0",
          right: "0",
          height: `${inputHeight() * 1.5}em`,
          background: "#2a2a2a",
        }}
      >
        {/* Orange prompt character */}
        <GridText col={0} row={0} text=">" fg="#e5c07b" bold />

        {/* Render attachments as badges */}
        {(() => {
          const elements: any[] = []
          let currentCol = 2

          // Render attachments first
          if (props.attachments && props.attachments.length > 0) {
            props.attachments.forEach((attachment) => {
              const badgeText = `[${attachment.label}]`
              elements.push(<GridText col={currentCol} row={0} text={badgeText} fg="#000000" bg="#d19a66" bold />)
              currentCol += badgeText.length + 1 // badge + space
            })
          }

          return elements
        })()}

        {/* Textarea for multi-line input with visible cursor */}
        <textarea
          ref={inputRef}
          value={props.value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          autofocus
          style={{
            position: "absolute",
            left: "2ch",
            top: "0",
            width: `${panelWidth - 4}ch`,
            height: `${inputHeight() * 1.5}em`,
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.5",
            background: "transparent",
            color: "#ffffff",
            "caret-color": "#d19a66",
            border: "none",
            outline: "none",
            padding: "0",
            margin: "0",
            resize: "none",
            "overflow-y": "hidden",
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
