import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { For, Show, createResource, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import os from "os"

export function DialogMemory() {
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()

  // Signal to trigger re-fetch when dialog opens
  const [fetchTrigger, setFetchTrigger] = createSignal(0)

  // Set dialog to xlarge size on mount and trigger fresh fetch
  onMount(() => {
    dialog.setSize("xlarge")
    setFetchTrigger((n) => n + 1)
  })

  // Read config directly from disk each time
  const [memoryFiles] = createResource(fetchTrigger, async () => {
    const projectDir = sync.data.path.directory || process.cwd()
    const configPath = path.join(projectDir, "opencode.json")

    // Read config directly from disk
    const configFile = Bun.file(configPath)
    if (!(await configFile.exists())) {
      return []
    }

    let config: { memory?: string[] }
    try {
      config = await configFile.json()
    } catch {
      return []
    }

    const memory = config.memory
    if (!memory || memory.length === 0) {
      return []
    }

    const resolvedPaths: string[] = []

    for (let memoryPath of memory) {
      // Handle ~/ paths
      if (memoryPath.startsWith("~/")) {
        memoryPath = path.join(os.homedir(), memoryPath.slice(2))
      }
      // Handle relative paths (resolve from project directory)
      else if (!path.isAbsolute(memoryPath)) {
        memoryPath = path.join(projectDir, memoryPath)
      }
      // Normalize the path
      memoryPath = path.normalize(memoryPath)
      resolvedPaths.push(memoryPath)
    }

    const results: Array<{ path: string; content: string | null; error?: string }> = []

    for (const memoryPath of resolvedPaths) {
      try {
        const file = Bun.file(memoryPath)
        if (await file.exists()) {
          const content = await file.text()
          results.push({ path: memoryPath, content: content || "(empty)" })
        }
        // Skip non-existent files - don't add them to results
      } catch (e) {
        // Only show errors for files that exist but failed to read
        results.push({ path: memoryPath, content: null, error: String(e) })
      }
    }

    return results
  })

  // Calculate max height for scrollbox (75% of terminal height)
  const maxHeight = () => Math.floor(dimensions().height * 0.75)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Memory Files
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={memoryFiles.loading}>
        <text fg={theme.textMuted}>Loading...</text>
      </Show>

      <Show when={!memoryFiles.loading && memoryFiles()}>
        <Show
          when={memoryFiles()!.length > 0}
          fallback={
            <text fg={theme.textMuted}>
              No memory files configured. You can tell the model to create some.
            </text>
          }
        >
          <scrollbox
            maxHeight={maxHeight()}
            viewportOptions={{
              paddingRight: 1,
            }}
            verticalScrollbarOptions={{
              paddingLeft: 1,
              visible: true,
              trackOptions: {
                backgroundColor: theme.backgroundElement,
                foregroundColor: theme.border,
              },
            }}
          >
            <For each={memoryFiles()!}>
              {(file) => (
                <box gap={0} paddingBottom={1}>
                  <box flexDirection="row" gap={1}>
                    <text
                      flexShrink={0}
                      style={{
                        fg: file.content !== null ? theme.success : theme.error,
                      }}
                    >
                      •
                    </text>
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      {path.basename(file.path)}
                    </text>
                    <text fg={theme.textMuted}>{file.path}</text>
                  </box>
                  <Show when={file.content !== null}>
                    <box paddingLeft={2}>
                      <text fg={theme.textMuted} wrapMode="word">
                        {file.content}
                      </text>
                    </box>
                  </Show>
                  <Show when={file.error}>
                    <box paddingLeft={2}>
                      <text fg={theme.error}>{file.error}</text>
                    </box>
                  </Show>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}
