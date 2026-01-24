import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
import { usePlatform } from "@/context/platform"
import { useTheme } from "@opencode-ai/ui/theme"
import { useEditor } from "@/context/editor"
import { useSettings } from "@/context/settings"
import { getFilename } from "@opencode-ai/util/path"
import { Icon } from "@opencode-ai/ui/icon"

// Set up Monaco workers
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker()
    if (label === "css" || label === "scss" || label === "less") return new cssWorker()
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker()
    if (label === "typescript" || label === "javascript") return new tsWorker()
    return new editorWorker()
  },
}

// Helper to get computed CSS variable value as a resolved color
function getCssVar(name: string): string {
  // Try reading from document.body first, then documentElement
  let value = getComputedStyle(document.body).getPropertyValue(name).trim()
  if (!value) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }
  return value
}

// Convert any color to hex format (Monaco requires hex colors)
function toHexColor(color: string): string {
  if (!color) return ""
  // If already hex, return as-is
  if (color.startsWith("#")) return color
  // Use a temporary element to convert any CSS color to rgb
  const temp = document.createElement("div")
  temp.style.color = color
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
  // Parse rgb(r, g, b) or rgba(r, g, b, a)
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0")
    const g = parseInt(match[2]).toString(16).padStart(2, "0")
    const b = parseInt(match[3]).toString(16).padStart(2, "0")
    return `#${r}${g}${b}`
  }
  return color
}

// Define custom OpenCode theme for Monaco that uses CSS variables
function defineOpenCodeTheme() {
  const isDark = document.documentElement.dataset.colorScheme === "dark"

  // Get colors from CSS variables and convert to hex
  const bgColorRaw = getCssVar("--surface-raised-stronger-non-alpha")
  const bgColor = toHexColor(bgColorRaw) || (isDark ? "#1e1e1e" : "#ffffff")
  const fgColor = isDark ? "#d4d4d4" : "#000000"
  const lineNumberColor = isDark ? "#858585" : "#237893"
  const selectionBg = isDark ? "#264f78" : "#add6ff"

  monaco.editor.defineTheme("opencode", {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bgColor,
      "editor.foreground": fgColor,
      "editorLineNumber.foreground": lineNumberColor,
      "editor.selectionBackground": selectionBg,
      "editor.lineHighlightBackground": isDark ? "#ffffff0a" : "#00000007",
      "editorCursor.foreground": fgColor,
    },
  })
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || ""
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    xml: "xml",
    sql: "sql",
    graphql: "graphql",
  }
  return languageMap[ext] || "plaintext"
}

// Cache for file content and view states
type FileCache = {
  originalContent: string // Content as loaded from disk
  currentContent: string  // Current content in editor (may be modified)
  viewState: monaco.editor.ICodeEditorViewState | null
  language: string
}

export function EditorPanel(props: { class?: string }) {
  const platform = usePlatform()
  const theme = useTheme()
  const editorCtx = useEditor()
  const settings = useSettings()

  let containerRef: HTMLDivElement | undefined
  const [editor, setEditor] = createSignal<monaco.editor.IStandaloneCodeEditor | undefined>(undefined)

  // Cache for each open file
  const fileCache = new Map<string, FileCache>()
  
  // File watchers for each open file
  const fileWatchers = new Map<string, () => void>()

  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [externalChange, setExternalChange] = createSignal(false)
  
  // Flag to ignore content changes when programmatically setting value
  let isSettingContent = false
  
  // Track the previous tab to save state before switching
  let previousTabPath: string | undefined

  // Initialize Monaco theme based on app color scheme
  const initMonacoTheme = () => {
    defineOpenCodeTheme()
    return "opencode"
  }

  const loadFileContent = async (filePath: string, isReload: boolean = false) => {
    const ed = editor()
    if (!platform.readFile || !ed) return

    if (!isReload) {
      setLoading(true)
      setError(null)
    }

    try {
      const fileContent = await platform.readFile(filePath)
      const cached = fileCache.get(filePath)

      // If this is a reload and file is dirty, check if disk content changed
      if (isReload && cached && fileContent !== cached.originalContent) {
        if (editorCtx.getTab(filePath)?.isDirty) {
          setExternalChange(true)
          return
        }
      }

      const language = getLanguageFromPath(filePath)

      // Update cache
      fileCache.set(filePath, {
        originalContent: fileContent,
        currentContent: fileContent,
        viewState: cached?.viewState ?? null,
        language,
      })

      // If this is the active file, update the editor
      if (editorCtx.activeTab() === filePath) {
        isSettingContent = true
        ed.setValue(fileContent)
        isSettingContent = false
        const model = ed.getModel()
        if (model) {
          monaco.editor.setModelLanguage(model, language)
        }
        if (cached?.viewState) {
          ed.restoreViewState(cached.viewState)
        }
      }

      editorCtx.setTabDirty(filePath, false)
      setExternalChange(false)
    } catch (err) {
      if (!isReload) {
        setError(err instanceof Error ? err.message : "Failed to load file")
        if (editorCtx.activeTab() === filePath) {
          isSettingContent = true
          ed.setValue("")
          isSettingContent = false
        }
      }
    } finally {
      if (!isReload) {
        setLoading(false)
      }
    }
  }

  // Save current view state before switching tabs
  const saveCurrentViewState = (path: string | undefined) => {
    const ed = editor()
    if (ed && path) {
      const cached = fileCache.get(path)
      if (cached) {
        cached.viewState = ed.saveViewState()
        cached.currentContent = ed.getValue()
      }
    }
  }

  // Start watching a file for changes
  const startWatching = async (filePath: string) => {
    // Stop any existing watcher for this file
    stopWatching(filePath)
    
    if (!platform.watchFile) return
    
    try {
      const unwatch = await platform.watchFile(filePath, async (event) => {
        // Only react to modify events
        if (event.type !== "modify") return
        
        // Check if this file is still open
        const tab = editorCtx.getTab(filePath)
        if (!tab) return
        
        const isActiveTab = editorCtx.activeTab() === filePath
        
        // Active tab - always prompt the user, never auto-reload
        if (isActiveTab) {
          editorCtx.setTabExternalChanges(filePath, true)
          setExternalChange(true)
          return
        }
        
        // Background tab with auto-reload enabled - reload silently
        if (settings.editor.autoReloadBackgroundFiles()) {
          editorCtx.setTabDirty(filePath, false)
          editorCtx.setTabExternalChanges(filePath, false)
          await loadFileContent(filePath, true)
          return
        }
        
        // Background tab with auto-reload disabled - mark for prompt when tab becomes active
        editorCtx.setTabExternalChanges(filePath, true)
      })
      
      fileWatchers.set(filePath, unwatch)
    } catch (err) {
      console.error("Failed to watch file:", filePath, err)
    }
  }
  
  const stopWatching = (filePath: string) => {
    const unwatch = fileWatchers.get(filePath)
    if (unwatch) {
      unwatch()
      fileWatchers.delete(filePath)
    }
  }
  
  const stopAllWatchers = () => {
    for (const unwatch of fileWatchers.values()) {
      unwatch()
    }
    fileWatchers.clear()
  }

  const reloadFromDisk = async () => {
    const path = editorCtx.activeTab()
    if (path) {
      editorCtx.setTabDirty(path, false)
      editorCtx.setTabExternalChanges(path, false)
      setExternalChange(false)
      await loadFileContent(path, false)
    }
  }

  const keepEditorVersion = () => {
    const path = editorCtx.activeTab()
    if (path) {
      // Keep the editor content, mark external changes as resolved
      // The file is still dirty (has unsaved changes)
      editorCtx.setTabExternalChanges(path, false)
      setExternalChange(false)
      
      // Update the original content in cache to match what's in the editor
      // This way, saving will overwrite the disk version
      const cached = fileCache.get(path)
      const ed = editor()
      if (cached && ed) {
        // Note: we don't update originalContent here because we want
        // to preserve the dirty state. The user chose to keep their edits.
      }
    }
  }

  const saveFile = async () => {
    const ed = editor()
    if (!platform.writeFile || !ed) return

    const path = editorCtx.activeTab()
    if (!path) return

    try {
      const content = ed.getValue()
      await platform.writeFile(path, content)

      // Update cache - saved content becomes the new original
      const cached = fileCache.get(path)
      if (cached) {
        cached.originalContent = content
        cached.currentContent = content
      }

      editorCtx.setTabDirty(path, false)
      editorCtx.setTabExternalChanges(path, false)
      setExternalChange(false)
    } catch (err) {
      console.error("Failed to save file:", err)
    }
  }

  const handleCloseTab = (e: MouseEvent, path: string) => {
    e.stopPropagation()
    // Stop watching and remove from cache
    stopWatching(path)
    fileCache.delete(path)
    editorCtx.closeTab(path)
  }

  onMount(() => {
    if (!containerRef) return

    const ed = monaco.editor.create(containerRef, {
      value: "",
      language: "plaintext",
      theme: initMonacoTheme(),
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "off",
      tabSize: 2,
      renderWhitespace: "selection",
      folding: true,
      padding: { top: 8, bottom: 8 },
    })

    // Track changes - only mark dirty if user made the change
    ed.onDidChangeModelContent(() => {
      if (isSettingContent) return
      const path = editorCtx.activeTab()
      if (path) {
        const cached = fileCache.get(path)
        if (cached) {
          const currentValue = ed.getValue()
          cached.currentContent = currentValue
          // Compare with original to determine dirty state
          const isDirty = currentValue !== cached.originalContent
          editorCtx.setTabDirty(path, isDirty)
        }
      }
    })

    // Save on Ctrl+S / Cmd+S
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile)

    // Set the editor signal - this triggers reactive effects
    setEditor(ed)
  })

  // Function to update Monaco theme from current CSS variables
  const updateMonacoTheme = () => {
    const ed = editor()
    if (ed) {
      defineOpenCodeTheme()
      monaco.editor.setTheme("opencode")
    }
  }

  // Update theme when app theme changes (for committed theme changes)
  createEffect(() => {
    // Track all theme-related signals to trigger updates
    theme.mode()
    theme.themeId()
    theme.colorScheme()
    const ed = editor()
    if (ed) {
      // Use setTimeout to ensure CSS variables have been updated after theme change
      setTimeout(updateMonacoTheme, 50)
    }
  })

  // Watch for theme preview changes via MutationObserver on the theme style element
  onMount(() => {
    const themeStyleEl = document.getElementById("oc-theme")
    if (themeStyleEl) {
      const observer = new MutationObserver(() => {
        // Small delay to ensure CSS is applied
        setTimeout(updateMonacoTheme, 10)
      })
      observer.observe(themeStyleEl, { childList: true, characterData: true, subtree: true })
      onCleanup(() => observer.disconnect())
    }
  })

  onCleanup(() => {
    stopAllWatchers()
    editor()?.dispose()
  })

  // Load file content when active tab changes
  createEffect(() => {
    const filePath = editorCtx.activeTab()
    const ed = editor()

    if (!filePath || !platform.readFile || !ed) {
      if (ed) {
        isSettingContent = true
        ed.setValue("")
        isSettingContent = false
      }
      previousTabPath = undefined
      return
    }

    // Save view state of previous file (only if different from current)
    if (previousTabPath && previousTabPath !== filePath) {
      saveCurrentViewState(previousTabPath)
    }
    previousTabPath = filePath

    // Check if we have cached content - this is synchronous and fast
    const cached = fileCache.get(filePath)
    if (cached) {
      isSettingContent = true
      ed.setValue(cached.currentContent)
      isSettingContent = false
      const model = ed.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, cached.language)
      }
      if (cached.viewState) {
        ed.restoreViewState(cached.viewState)
      }
      setError(null)
      setLoading(false)
      
      // Show external change prompt if this tab has pending external changes
      const tab = editorCtx.getTab(filePath)
      if (tab?.hasExternalChanges) {
        setExternalChange(true)
      } else {
        setExternalChange(false)
      }
    } else {
      // Load from disk asynchronously and start watching
      loadFileContent(filePath).then(() => {
        startWatching(filePath)
      })
    }
    
    // Start watching if we loaded from cache
    if (fileCache.has(filePath) && !fileWatchers.has(filePath)) {
      startWatching(filePath)
    }
  })

  return (
    <div class={`flex flex-col h-full bg-surface-base ${props.class ?? ""}`}>
      {/* Tab bar */}
      <Show when={editorCtx.tabs.length > 0}>
        <div class="flex items-center border-b border-border-base bg-background-stronger overflow-x-auto no-scrollbar">
          <For each={[...editorCtx.tabs]}>
            {(tab) => {
              const isActive = () => editorCtx.activeTab() === tab.path
              const tabPath = tab.path
              return (
                <div
                  classList={{
                    "group flex items-center gap-1.5 px-3 py-1.5 border-r border-border-base text-13-regular cursor-pointer transition-colors select-none": true,
                    "bg-surface-base text-text-strong": isActive(),
                    "bg-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-base": !isActive(),
                  }}
                  onClick={() => editorCtx.setActiveTab(tabPath)}
                  title={tabPath}
                >
                  <span class="truncate max-w-[150px]">{getFilename(tabPath)}</span>
                  <Show when={tab.hasExternalChanges}>
                    <span class="w-2 h-2 rounded-full bg-text-warning shrink-0" title="File changed on disk" />
                  </Show>
                  <Show when={tab.isDirty && !tab.hasExternalChanges}>
                    <span class="w-2 h-2 rounded-full bg-text-weak shrink-0" title="Unsaved changes" />
                  </Show>
                  <div
                    class="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-surface-base-active opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleCloseTab(e, tabPath)}
                    title="Close"
                  >
                    <Icon name="close" size="small" class="w-3 h-3" />
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      {/* Status bar for active file */}
      <Show when={editorCtx.activeTab()}>
        <div class="px-3 py-1.5 border-b border-border-base flex items-center gap-2 text-12-regular">
          <span class="text-text-weak truncate flex-1" title={editorCtx.activeTab()}>
            {editorCtx.activeTab()}
          </span>
          <Show when={loading()}>
            <span class="text-text-weak">Loading...</span>
          </Show>
          <Show when={error()}>
            <span class="text-text-critical">{error()}</span>
          </Show>
          <Show when={externalChange()}>
            <span class="text-text-warning">File changed on disk</span>
            <button class="text-text-info hover:underline" onClick={reloadFromDisk}>
              Reload
            </button>
          </Show>
        </div>
      </Show>

      {/* Editor container */}
      <div ref={containerRef} class="flex-1 min-h-0" />

      {/* Empty state */}
      <Show when={!editorCtx.tabs.length}>
        <div class="absolute inset-0 flex items-center justify-center text-text-weak text-13-regular">
          Select a file to edit
        </div>
      </Show>
    </div>
  )
}
