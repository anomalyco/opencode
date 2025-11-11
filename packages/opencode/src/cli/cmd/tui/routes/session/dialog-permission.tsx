import { ScrollBoxRenderable, TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { createStore } from "solid-js/store"
import { createMemo, For, onMount, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Locale } from "@/util/locale"
import type { Permission } from "@/permission"
import { useSDK } from "../../context/sdk"
import { parsePatch } from "diff"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import * as path from "path"
import { useLocal } from "../../context/local"

export type DialogPermissionProps = {
  permissions: Permission.Info[]
  sessionID: string
}

export function DialogPermission(props: DialogPermissionProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const local = useLocal()

  const [store, setStore] = createStore({
    selectedIndex: 0,
    selectedAgentIndex: 0,
  })

  let diffScrollBox: ScrollBoxRenderable

  const currentPermission = createMemo(() => {
    if (!props.permissions.length) return null
    const index = Math.min(store.selectedIndex, props.permissions.length - 1)
    return props.permissions[index]
  })
  const hasMultiple = createMemo(() => props.permissions.length > 1)

  const availableAgents = createMemo(() => local.agent.list())
  const selectedAgent = createMemo(() => {
    const perm = currentPermission()
    if (!perm || perm.type !== "exit-plan-mode") return null
    const agents = availableAgents()
    const defaultAgent = (perm.metadata.switchToAgent as string) || "build"
    const defaultIndex = agents.findIndex((a) => a.name === defaultAgent)
    const index = defaultIndex >= 0 ? defaultIndex : 0
    return agents[Math.min(store.selectedAgentIndex || index, agents.length - 1)]
  })

  onMount(() => {
    const perm = currentPermission()
    if (perm && perm.type === "exit-plan-mode") {
      const defaultAgent = (perm.metadata.switchToAgent as string) || "build"
      const agents = availableAgents()
      const index = agents.findIndex((a) => a.name === defaultAgent)
      if (index >= 0) setStore("selectedAgentIndex", index)
    }
  })

  // Parse diff and create colored content (same as Edit Tool in session/index.tsx)
  const parsedDiff = createMemo(() => {
    const perm = currentPermission()
    if (!perm || perm.type !== "edit") return null

    const diff = perm.metadata.diff as string | undefined
    if (!diff) return null

    try {
      const patches = parsePatch(diff)
      if (patches.length === 0) return null

      const patch = patches[0]
      const oldLines: string[] = []
      const newLines: string[] = []

      for (const hunk of patch.hunks) {
        let i = 0
        while (i < hunk.lines.length) {
          const line = hunk.lines[i]

          if (line.startsWith("-")) {
            const removedLines: string[] = []
            while (i < hunk.lines.length && hunk.lines[i].startsWith("-")) {
              removedLines.push("- " + hunk.lines[i].slice(1))
              i++
            }

            const addedLines: string[] = []
            while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
              addedLines.push("+ " + hunk.lines[i].slice(1))
              i++
            }

            const maxLen = Math.max(removedLines.length, addedLines.length)
            for (let j = 0; j < maxLen; j++) {
              oldLines.push(removedLines[j] ?? "")
              newLines.push(addedLines[j] ?? "")
            }
          } else if (line.startsWith("+")) {
            const addedLines: string[] = []
            while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
              addedLines.push("+ " + hunk.lines[i].slice(1))
              i++
            }

            for (const added of addedLines) {
              oldLines.push("")
              newLines.push(added)
            }
          } else {
            oldLines.push("  " + line.slice(1))
            newLines.push("  " + line.slice(1))
            i++
          }
        }
      }

      return {
        oldContent: oldLines.join("\n"),
        newContent: newLines.join("\n"),
      }
    } catch (error) {
      return null
    }
  })

  // File type for syntax highlighting (from EditTool pattern)
  const filetype = createMemo(() => {
    const perm = currentPermission()
    if (!perm || !perm.metadata.filePath) return "none"
    const filePath = perm.metadata.filePath as string
    const ext = path.extname(filePath)
    const language = LANGUAGE_EXTENSIONS[ext]
    if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
    return language || "none"
  })

  // Calculate max heights dynamically based on screen size
  // Reserve space for: header (3), mode indicator (2), details header (1), actions (4), padding (4) = ~14 lines fixed
  const fixedOverhead = 14
  const availableHeight = createMemo(() => Math.max(20, Math.floor(dimensions().height * 0.8) - fixedOverhead))

  // Dynamically scale content sections based on available height
  const detailsMaxHeight = createMemo(() => Math.max(3, Math.min(8, Math.floor(availableHeight() * 0.2))))
  const diffMaxHeight = createMemo(() => Math.max(10, Math.min(30, Math.floor(availableHeight() * 0.6))))
  const maxMetadataLines = createMemo(() => Math.max(2, Math.min(6, Math.floor(availableHeight() * 0.1))))

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    const perm = currentPermission()

    // Agent selection for exit-plan-mode permissions (left/right arrows)
    if (perm && perm.type === "exit-plan-mode") {
      if (evt.name === "left") {
        const agents = availableAgents()
        const prev = (store.selectedAgentIndex - 1 + agents.length) % agents.length
        setStore("selectedAgentIndex", prev)
        evt.preventDefault()
        return
      }
      if (evt.name === "right") {
        const agents = availableAgents()
        const next = (store.selectedAgentIndex + 1) % agents.length
        setStore("selectedAgentIndex", next)
        evt.preventDefault()
        return
      }
    }

    // Scroll navigation for diff content (only for non-exit-plan-mode)
    if (perm && perm.type !== "exit-plan-mode") {
      if (evt.name === "up" || evt.name === "k") {
        if (diffScrollBox) {
          diffScrollBox.scrollBy(-1)
        }
        evt.preventDefault()
      }
      if (evt.name === "down" || evt.name === "j") {
        if (diffScrollBox) {
          diffScrollBox.scrollBy(1)
        }
        evt.preventDefault()
      }
    }

    // Actions
    if (evt.name === "return") {
      if (perm) respondToPermission(perm.id, "once")
      evt.preventDefault()
    }
    if (evt.name === "a") {
      const perm = currentPermission()
      if (perm) respondToPermission(perm.id, "always")
      evt.preventDefault()
    }
    if (evt.name === "d") {
      const perm = currentPermission()
      if (perm) respondToPermission(perm.id, "reject")
      evt.preventDefault()
    }
    if (evt.name === "r") {
      rejectAll()
      evt.preventDefault()
    }
    if (evt.name === "escape") {
      rejectAll()
      evt.preventDefault()
    }
  })

  function respondToPermission(permissionID: string, response: Permission.Response) {
    const perm = props.permissions.find((p) => p.id === permissionID)

    if (perm && perm.type === "exit-plan-mode" && (response === "once" || response === "always")) {
      const agent = selectedAgent()
      if (agent) local.agent.set(agent.name)
    }

    sdk.client.postSessionIdPermissionsPermissionId({
      path: {
        permissionID,
        id: props.sessionID,
      },
      body: {
        response,
      },
    })

    // Update selected index to handle the removed permission
    // The dialog will auto-close via the reactive effect in session/index.tsx
    // when permissions array becomes empty
    const currentIndex = props.permissions.findIndex((p) => p.id === permissionID)
    if (currentIndex !== -1 && store.selectedIndex >= currentIndex && store.selectedIndex > 0) {
      setStore("selectedIndex", Math.max(0, store.selectedIndex - 1))
    }
  }

  function rejectAll() {
    for (const permission of props.permissions) {
      sdk.client.postSessionIdPermissionsPermissionId({
        path: {
          permissionID: permission.id,
          id: props.sessionID,
        },
        body: {
          response: "reject",
        },
      })
    }
    dialog.clear()
  }

  // Truncate metadata entries for responsiveness (exclude diff for edit permissions)
  const visibleMetadata = createMemo(() => {
    const perm = currentPermission()
    if (!perm) return []
    const entries = Object.entries(perm.metadata).filter(([key]) => key !== "diff")
    const maxLines = maxMetadataLines()
    if (entries.length <= maxLines) return entries
    return entries.slice(0, maxLines)
  })

  const hasMoreMetadata = createMemo(() => {
    const perm = currentPermission()
    if (!perm) return false
    const entries = Object.entries(perm.metadata).filter(([key]) => key !== "diff")
    return entries.length > maxMetadataLines()
  })

  return (
    <Show when={currentPermission()}>
      <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
        {/* Header */}
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>
            Permission Request
            <Show when={hasMultiple()}>
              {" "}
              ({store.selectedIndex + 1}/{props.permissions.length})
            </Show>
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>

        {/* Current permission details - Scrollable */}
        <scrollbox
          paddingTop={1}
          paddingBottom={1}
          gap={1}
          backgroundColor={theme.backgroundElement}
          maxHeight={detailsMaxHeight()}
          scrollbarOptions={{ visible: false }}
        >
          <box paddingLeft={1} paddingRight={1} gap={1}>
            <text attributes={TextAttributes.BOLD}>{currentPermission()!.title}</text>

            {/* Show indicator for subagent permissions */}
            <Show when={currentPermission()!.metadata?.originSessionID}>
              <text fg={theme.accent}>
                ⚡ From subagent: {(currentPermission()!.metadata?.originSessionTitle as string) || "Unknown"}
              </text>
            </Show>

            <text fg={theme.textMuted}>Type: {currentPermission()!.type}</text>

            {/* Show file path for edit permissions */}
            <Show when={currentPermission()!.type === "edit" && currentPermission()!.metadata.filePath}>
              <text fg={theme.textMuted}>File: {currentPermission()!.metadata.filePath as string}</text>
            </Show>

            <Show when={currentPermission()!.pattern}>
              <text fg={theme.textMuted}>
                Pattern:{" "}
                {Array.isArray(currentPermission()!.pattern)
                  ? (currentPermission()!.pattern as string[]).join(", ")
                  : (currentPermission()!.pattern as string)}
              </text>
            </Show>

            {/* Show metadata for non-edit permissions or remaining edit metadata */}
            <Show when={visibleMetadata().length > 0}>
              <box paddingTop={1}>
                <text fg={theme.textMuted}>Details:</text>
                <For each={visibleMetadata()}>
                  {([key, value]) => (
                    <text fg={theme.textMuted}>
                      •{" "}
                      {Locale.truncate(
                        `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
                        Math.max(60, dimensions().width - 20),
                      )}
                    </text>
                  )}
                </For>
                <Show when={hasMoreMetadata()}>
                  <text fg={theme.textMuted}>
                    ... and{" "}
                    {Object.entries(currentPermission()!.metadata).filter(([key]) => key !== "diff").length -
                      maxMetadataLines()}{" "}
                    more
                  </text>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        {/* Diff display for Edit permissions - split view with colored syntax highlighting */}
        <Show when={currentPermission()!.type === "edit" && parsedDiff()}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (diffScrollBox = r)}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundElement}
            maxHeight={diffMaxHeight()}
            verticalScrollbarOptions={{ visible: true }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <box paddingLeft={1} flexDirection="row" gap={2}>
              <box flexGrow={1} flexBasis={0}>
                <code filetype={filetype()} syntaxStyle={syntax()} content={parsedDiff()!.oldContent} />
              </box>
              <box flexGrow={1} flexBasis={0}>
                <code filetype={filetype()} syntaxStyle={syntax()} content={parsedDiff()!.newContent} />
              </box>
            </box>
          </scrollbox>
        </Show>

        {/* Plan display for exit-plan-mode permissions */}
        <Show when={currentPermission()!.type === "exit-plan-mode" && currentPermission()!.metadata.plan}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (diffScrollBox = r)}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundElement}
            maxHeight={diffMaxHeight()}
            verticalScrollbarOptions={{ visible: true }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <box paddingLeft={1} paddingRight={1}>
              <code filetype="markdown" syntaxStyle={syntax()} content={currentPermission()!.metadata.plan as string} />
            </box>
          </scrollbox>

          {/* Agent selection for exit-plan-mode */}
          <box paddingTop={1} paddingLeft={1} gap={1}>
            <text fg={theme.textMuted}>Switch to agent:</text>
            <box flexDirection="row" flexWrap="wrap" gap={1}>
              <For each={availableAgents()}>
                {(agent, index) => (
                  <text>
                    <Show when={index() === store.selectedAgentIndex}>
                      <b style={{ fg: local.agent.color(agent.name) }}>{agent.name}</b>
                    </Show>
                    <Show when={index() !== store.selectedAgentIndex}>
                      <span style={{ fg: theme.textMuted }}>{agent.name}</span>
                    </Show>
                  </text>
                )}
              </For>
            </box>
          </box>
        </Show>

        {/* Actions - Always visible at bottom */}
        <box paddingTop={1} flexShrink={0}>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <text>
              <b style={{ fg: theme.primary }}>↵</b>
              <span style={{ fg: theme.textMuted }}> once</span>
            </text>
            <text>
              <b style={{ fg: theme.success }}>a</b>
              <span style={{ fg: theme.textMuted }}> always</span>
            </text>
            <text>
              <b style={{ fg: theme.error }}>d</b>
              <span style={{ fg: theme.textMuted }}> deny</span>
            </text>
            <Show when={hasMultiple()}>
              <text>
                <b style={{ fg: theme.warning }}>r</b>
                <span style={{ fg: theme.textMuted }}> reject all</span>
              </text>
            </Show>
            <Show when={currentPermission()!.type === "exit-plan-mode"}>
              <text>
                <b style={{ fg: theme.accent }}>←→</b>
                <span style={{ fg: theme.textMuted }}> select agent</span>
              </text>
            </Show>
            <Show when={currentPermission()!.type !== "exit-plan-mode"}>
              <text>
                <b style={{ fg: theme.textMuted }}>↑↓/jk</b>
                <span style={{ fg: theme.textMuted }}> scroll</span>
              </text>
            </Show>
          </box>
        </box>
      </box>
    </Show>
  )
}
