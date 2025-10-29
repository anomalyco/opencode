import { Show, For, onMount, onCleanup, createEffect } from "solid-js"
import loader from "@monaco-editor/loader"
import type * as Monaco from "monaco-editor"
import {
  openFiles,
  activeFileIndex,
  setActiveFileIndex,
  closeFile,
  updateFileContent,
  saveCurrentFile,
  getActiveFile,
} from "../stores/files"

export function CodeEditor() {
  let editorContainer: HTMLDivElement | undefined
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined

  onMount(async () => {
    // Configure Monaco loader
    loader.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
      },
    })

    // Load Monaco
    const monaco = await loader.init()

    // Create editor
    if (editorContainer) {
      editor = monaco.editor.create(editorContainer, {
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        lineNumbers: "on",
        rulers: [80, 120],
        wordWrap: "on",
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 2,
      })

      // Listen for content changes
      editor.onDidChangeModelContent(() => {
        const index = activeFileIndex()
        if (index !== null && editor) {
          const content = editor.getValue()
          updateFileContent(index, content)
        }
      })

      // Keyboard shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSave()
      })
    }
  })

  // Update editor content when active file changes
  createEffect(() => {
    const activeFile = getActiveFile()
    if (editor && activeFile) {
      const currentModel = editor.getModel()
      const monaco = loader.__getMonacoInstance()

      if (monaco) {
        // Create new model for the file
        const uri = monaco.Uri.file(activeFile.path)
        let model = monaco.editor.getModel(uri)

        if (!model) {
          model = monaco.editor.createModel(activeFile.content, activeFile.language, uri)
        } else {
          // Update existing model
          if (model.getValue() !== activeFile.content) {
            model.setValue(activeFile.content)
          }
        }

        editor.setModel(model)
      }
    } else if (editor) {
      // No active file, clear editor
      editor.setModel(null)
    }
  })

  onCleanup(() => {
    editor?.dispose()
  })

  const handleSave = async () => {
    try {
      await saveCurrentFile()
      // Show success notification (could add toast here)
      console.log("File saved successfully")
    } catch (error) {
      console.error("Failed to save file:", error)
      alert("Failed to save file")
    }
  }

  const handleCloseTab = (index: number, e: MouseEvent) => {
    e.stopPropagation()
    closeFile(index)
  }

  return (
    <div class="flex flex-col h-full bg-gray-950">
      {/* Tabs */}
      <Show when={openFiles().length > 0}>
        <div class="flex items-center bg-gray-900 border-b border-gray-800 overflow-x-auto">
          <For each={openFiles()}>
            {(file, index) => (
              <button
                class={`
                  flex items-center gap-2 px-4 py-2 border-r border-gray-800
                  transition-colors relative group
                  ${
                    activeFileIndex() === index()
                      ? "bg-gray-950 text-gray-100"
                      : "bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  }
                `}
                onClick={() => setActiveFileIndex(index())}
              >
                {/* File name */}
                <span class="text-sm truncate max-w-[150px]">
                  {file.path.split("/").pop()}
                </span>

                {/* Dirty indicator */}
                <Show when={file.isDirty}>
                  <div class="w-2 h-2 bg-primary-500 rounded-full" title="Unsaved changes" />
                </Show>

                {/* Close button */}
                <button
                  class="ml-1 p-0.5 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleCloseTab(index(), e)}
                  title="Close"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </button>
            )}
          </For>

          {/* Save button */}
          <Show when={getActiveFile()?.isDirty}>
            <button
              class="ml-auto px-4 py-2 text-sm text-primary-400 hover:text-primary-300 hover:bg-gray-800"
              onClick={handleSave}
              title="Save (Ctrl/Cmd + S)"
            >
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                <span>Save</span>
              </div>
            </button>
          </Show>
        </div>
      </Show>

      {/* Editor */}
      <div class="flex-1 relative">
        <Show
          when={openFiles().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full text-gray-500">
              <div class="text-center">
                <svg
                  class="w-20 h-20 mx-auto mb-4 opacity-20"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                <p class="text-lg text-gray-400">No file open</p>
                <p class="text-sm text-gray-600 mt-1">
                  Select a file from the file browser to start editing
                </p>
              </div>
            </div>
          }
        >
          <div ref={editorContainer} class="w-full h-full" />
        </Show>
      </div>

      {/* Status bar */}
      <Show when={getActiveFile()}>
        {(file) => (
          <div class="flex items-center justify-between px-4 py-1 bg-gray-900 border-t border-gray-800 text-xs text-gray-400">
            <div class="flex items-center gap-4">
              <span>{file().path}</span>
              <span>•</span>
              <span class="capitalize">{file().language}</span>
            </div>
            <div class="flex items-center gap-4">
              <Show when={file().isDirty}>
                <span class="text-primary-400">Modified</span>
              </Show>
              <span>UTF-8</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
