import type { Component } from "solid-js"
import { createSignal, createEffect, onMount } from "solid-js"
import type * as Monaco from "monaco-editor"
import { codeEditorTheme } from "../theme/monaco-theme"

interface CodeEditorProps {
  filePath: string
  content: string
  language?: string
  readOnly?: boolean
  onClose?: () => void
  onSave?: (content: string) => void
}

export const CodeEditor: Component<CodeEditorProps> = (props) => {
  let containerRef: HTMLDivElement | undefined
  let editorRef: Monaco.editor.IStandaloneCodeEditor | undefined
  let monacoRef: typeof Monaco | undefined
  const [currentContent, setCurrentContent] = createSignal(props.content)
  const [isDirty, setIsDirty] = createSignal(false)
  const [isReady, setIsReady] = createSignal(false)

  // Auto-detect language from file extension
  const getLanguage = () => {
    if (props.language) return props.language

    const ext = props.filePath.split(".").pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      md: "markdown",
      css: "css",
      html: "html",
      py: "python",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      sh: "shell",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      xml: "xml",
      sql: "sql",
    }

    return langMap[ext || ""] || "plaintext"
  }

  onMount(async () => {
    if (!containerRef) return

    // Dynamically import monaco to avoid SSR issues
    const monaco = await import("monaco-editor")
    monacoRef = monaco

    // Define custom theme
    monaco.editor.defineTheme("codesurf-dark", codeEditorTheme)
    monaco.editor.setTheme("codesurf-dark")

    // Create editor
    const editor = monaco.editor.create(containerRef, {
      value: props.content,
      language: getLanguage(),
      theme: "codesurf-dark",
      readOnly: props.readOnly,
      minimap: { enabled: true },
      fontSize: 16,
      fontFamily: '"Berkeley Mono", "JetBrains Mono", "Monaco", monospace',
      lineHeight: 24,
      padding: { top: 16, bottom: 16 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      renderWhitespace: "selection",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
    })

    editorRef = editor
    setIsReady(true)

    // Set up change listener
    editor.onDidChangeModelContent(() => {
      const newContent = editor.getValue()
      setCurrentContent(newContent)
      setIsDirty(newContent !== props.content)
    })

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave()
    })

    editor.addCommand(monaco.KeyCode.Escape, () => {
      if (props.onClose) {
        props.onClose()
      }
    })
  })

  const handleSave = () => {
    if (props.onSave && isDirty()) {
      props.onSave(currentContent())
      setIsDirty(false)
    }
  }

  // Update editor content when props change
  createEffect(() => {
    if (editorRef && props.content !== currentContent()) {
      editorRef.setValue(props.content)
      setIsDirty(false)
    }
  })

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        "z-index": 1000,
        background: "#0a0a0a",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          height: "2.4em",
          background: "#1a1a1a",
          "border-bottom": "1px solid #2a2a2a",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "0 1ch",
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
          "font-size": "16px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "2ch" }}>
          <span style={{ color: "#ffffff" }}>{props.filePath}</span>
          {isDirty() && <span style={{ color: "#e5c07b" }}>●</span>}
          {props.readOnly && <span style={{ color: "#6a6a6a", "font-size": "14px" }}>(read-only)</span>}
        </div>
        <div style={{ display: "flex", gap: "2ch", "align-items": "center" }}>
          {!props.readOnly && isDirty() && (
            <span
              onClick={handleSave}
              style={{
                color: "#98c379",
                cursor: "pointer",
                "user-select": "none",
              }}
            >
              Save (Ctrl+S)
            </span>
          )}
          <span
            onClick={props.onClose}
            style={{
              color: "#e06c75",
              cursor: "pointer",
              "user-select": "none",
            }}
          >
            Close (ESC)
          </span>
        </div>
      </div>

      {/* Monaco Editor */}
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }} />

      {/* Footer Bar */}
      <div
        style={{
          height: "1.8em",
          background: "#000000",
          "border-top": "1px solid #2a2a2a",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "0 1ch",
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
          "font-size": "14px",
          color: "#858585",
        }}
      >
        <span>
          {getLanguage()} • {currentContent().split("\n").length} lines
        </span>
        <span>{isDirty() ? "Modified" : "Saved"}</span>
      </div>
    </div>
  )
}
