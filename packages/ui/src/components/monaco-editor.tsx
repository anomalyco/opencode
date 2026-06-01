import { onMount, onCleanup, createSignal, Show, type VoidComponent } from "solid-js"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
import { getLanguageForFile } from "../utils/language-map"

// @ts-ignore
self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new jsonWorker()
    if (label === "css" || label === "scss" || label === "less") return new cssWorker()
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker()
    if (label === "typescript" || label === "javascript") return new tsWorker()
    return new editorWorker()
  },
}

let monaco: typeof import("monaco-editor") | undefined

async function getMonaco() {
  if (!monaco) {
    monaco = await import("monaco-editor")
  }
  return monaco
}

export interface MonacoEditorProps {
  filePath: string
  content: string
  onSave?: (content: string) => void
  readOnly?: boolean
  class?: string
}

export const MonacoEditor: VoidComponent<MonacoEditorProps> = (props) => {
  let containerRef!: HTMLDivElement
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | undefined
  const [loaded, setLoaded] = createSignal(false)

  const isDark = () =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-color-scheme") === "dark"

  const themeName = () => (isDark() ? "opencode-dark" : "opencode-light")

  onMount(async () => {
    const m = await getMonaco()
    const language = getLanguageForFile(props.filePath)

    m.editor.defineTheme("opencode-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0a0a0a",
        "editor.foreground": "#e4e4e7",
        "editor.lineHighlightBackground": "#1a1a1a",
        "editorCursor.foreground": "#e4e4e7",
        "editor.selectionBackground": "#27272a",
        "editor.inactiveSelectionBackground": "#1a1a1a",
      },
    })

    m.editor.defineTheme("opencode-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1a1a1a",
        "editor.lineHighlightBackground": "#f5f5f5",
        "editorCursor.foreground": "#1a1a1a",
        "editor.selectionBackground": "#d4d4d8",
        "editor.inactiveSelectionBackground": "#e4e4e7",
      },
    })

    editor = m.editor.create(containerRef, {
      value: props.content,
      language,
      theme: themeName(),
      readOnly: props.readOnly ?? false,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "var(--font-family-mono, 'Menlo', 'Monaco', 'Courier New', monospace)",
      lineHeight: 24,
      padding: { top: 8, bottom: 8 },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      wordWrap: "off",
      tabSize: 2,
      insertSpaces: true,
      folding: true,
      links: true,
      colorDecorators: true,
      contextmenu: true,
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        useShadows: false,
      },
    })

    // Ctrl+S / Cmd+S save
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      if (props.onSave && !props.readOnly) {
        props.onSave(editor!.getValue())
      }
    })

    // Theme observer
    const observer = new MutationObserver(() => {
      m.editor.setTheme(themeName())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    })

    setLoaded(true)

    onCleanup(() => {
      observer.disconnect()
      editor?.dispose()
      editor = undefined
    })
  })

  return (
    <div
      class={props.class}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    >
      <Show when={!loaded()}>
        <div
          style={{
            position: "absolute",
            inset: "0",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "var(--text-muted)",
            "font-size": "var(--font-size-small)",
          }}
        >
          Loading editor...
        </div>
      </Show>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  )
}
