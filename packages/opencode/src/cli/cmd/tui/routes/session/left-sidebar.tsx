import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import path from "path"
import type { ToolPart as SessionToolPart } from "@opencode-ai/sdk/v2"
import { useSync } from "@tui/context/sync"
import { selectedForeground, useTheme } from "../../context/theme"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

export const LEFT_SIDEBAR_WIDTH = 44

function normalizeFileKey(file: string, cwd: string) {
  const normalized = file.replace(/\\/g, "/")
  if (path.isAbsolute(file)) {
    const relative = path.relative(cwd, file).replace(/\\/g, "/")
    if (relative && !relative.startsWith("..")) return relative
  }
  return normalized
}

function hasToolName(tool: string | undefined, expected: string) {
  const value = (tool ?? "").toLowerCase()
  return value === expected || value.endsWith(`.${expected}`)
}

function toGitPath(file: string, cwd: string) {
  if (path.isAbsolute(file)) {
    const relative = path.relative(cwd, file)
    if (relative && !relative.startsWith("..")) return relative
  }
  return file
}

export function LeftSidebar(props: {
  sessionID: string
  overlay?: boolean
  width?: number
  onNarrow?: () => void
  onWiden?: () => void
}) {
  const sync = useSync()
  const { theme, syntax } = useTheme()
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const cwd = createMemo(() => sync.data.path.directory || process.cwd())
  const parts = createMemo(() => messages().flatMap((message) => sync.data.part[message.id] ?? []))
  const toolParts = createMemo(() => parts().filter((part): part is SessionToolPart => part.type === "tool"))
  const [selectedFile, setSelectedFile] = createSignal<string>()
  const [gitDiffCache, setGitDiffCache] = createSignal<Record<string, string>>({})
  const [gitDiffLoaded, setGitDiffLoaded] = createSignal<Record<string, boolean>>({})

  createEffect(() => {
    const files = diff()
    const current = selectedFile()
    if (files.length === 0) {
      setSelectedFile(undefined)
      return
    }
    if (!current || !files.some((item) => item.file === current)) {
      setSelectedFile(files[0]!.file)
    }
  })

  const toolDiffByFile = createMemo(() => {
    const output = new Map<string, string>()
    const base = cwd()
    for (const part of toolParts()) {
      if (part.state.status !== "completed") continue
      const metadata = (part.state.metadata ?? {}) as {
        diff?: unknown
        files?: Array<{ diff?: unknown; relativePath?: unknown; filePath?: unknown }>
      }
      const input = (part.state.input ?? {}) as { filePath?: unknown }

      if (hasToolName(part.tool, "edit")) {
        if (typeof metadata.diff !== "string") continue
        if (typeof input.filePath !== "string") continue
        output.set(normalizeFileKey(input.filePath, base), metadata.diff)
        continue
      }

      if (!hasToolName(part.tool, "apply_patch")) continue
      if (!Array.isArray(metadata.files)) continue
      for (const file of metadata.files) {
        if (typeof file.diff !== "string") continue
        const filepath = typeof file.relativePath === "string" ? file.relativePath : file.filePath
        if (typeof filepath !== "string") continue
        output.set(normalizeFileKey(filepath, base), file.diff)
      }
    }
    return output
  })

  const selectedItem = createMemo(() => diff().find((item) => item.file === selectedFile()))
  const selectedDiff = createMemo(() => {
    const item = selectedItem()
    if (!item) return undefined
    return toolDiffByFile().get(normalizeFileKey(item.file, cwd()))
  })
  const selectedFileKey = createMemo(() => {
    const item = selectedItem()
    if (!item) return undefined
    return normalizeFileKey(item.file, cwd())
  })

  createEffect(() => {
    const key = selectedFileKey()
    const item = selectedItem()
    const currentCwd = cwd()
    if (!key || !item) return
    if (toolDiffByFile().has(key)) return
    if (gitDiffLoaded()[key]) return

    let cancelled = false
    setGitDiffLoaded((prev) => ({ ...prev, [key]: true }))

    const load = async () => {
      const filepath = toGitPath(item.file, currentCwd)
      const unstaged = Bun.spawn({
        cmd: ["git", "-C", currentCwd, "diff", "--", filepath],
        stdout: "pipe",
        stderr: "pipe",
      })
      const unstagedText = await new Response(unstaged.stdout).text()
      await unstaged.exited
      if (cancelled) return
      if (unstagedText.trim()) {
        setGitDiffCache((prev) => ({ ...prev, [key]: unstagedText }))
        return
      }

      const staged = Bun.spawn({
        cmd: ["git", "-C", currentCwd, "diff", "--cached", "--", filepath],
        stdout: "pipe",
        stderr: "pipe",
      })
      const stagedText = await new Response(staged.stdout).text()
      await staged.exited
      if (cancelled) return
      if (stagedText.trim()) {
        setGitDiffCache((prev) => ({ ...prev, [key]: stagedText }))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  })

  const selectedPreviewDiff = createMemo(() => {
    const key = selectedFileKey()
    if (!key) return undefined
    return selectedDiff() ?? gitDiffCache()[key]
  })
  const selectedFiletype = createMemo(() => {
    const file = selectedItem()?.file
    if (!file) return "none"
    const ext = path.extname(file)
    const language = LANGUAGE_EXTENSIONS[ext]
    if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
    return language ?? "none"
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={props.width ?? LEFT_SIDEBAR_WIDTH}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
    >
      <scrollbox flexGrow={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>
            <b>브랜치 변경사항</b>
          </text>
          <text fg={theme.textMuted}>{sync.data.vcs?.branch ?? "-"}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>폭 {props.width ?? LEFT_SIDEBAR_WIDTH}</text>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted} onMouseDown={() => props.onNarrow?.()}>
              [ - ]
            </text>
            <text fg={theme.textMuted} onMouseDown={() => props.onWiden?.()}>
              [ + ]
            </text>
          </box>
        </box>
        <text fg={theme.textMuted}>{diff().length} files</text>
        <Show when={diff().length > 0} fallback={<text fg={theme.textMuted}>변경된 파일이 없습니다</text>}>
          <For each={diff()}>
            {(item) => {
              const selected = createMemo(() => selectedFile() === item.file)
              return (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  gap={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() ? theme.backgroundElement : undefined}
                  onMouseDown={() => setSelectedFile(item.file)}
                >
                  <text
                    fg={selected() ? selectedForeground(theme, theme.backgroundElement) : theme.text}
                    wrapMode="none"
                  >
                    {item.file}
                  </text>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    <Show when={item.additions > 0}>
                      <text fg={theme.diffAdded}>+{item.additions}</text>
                    </Show>
                    <Show when={item.deletions > 0}>
                      <text fg={theme.diffRemoved}>-{item.deletions}</text>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </Show>
        <Show when={selectedItem()}>
          <box marginTop={1}>
            <text fg={theme.text}>
              <b>Diff 미리보기</b>
            </text>
            <text fg={theme.textMuted}>{selectedItem()!.file}</text>
            <Show when={selectedPreviewDiff()} fallback={<text fg={theme.textMuted}>표시할 패치 본문이 없습니다</text>}>
              <box paddingLeft={1}>
                <diff
                  diff={selectedPreviewDiff()!}
                  view="unified"
                  filetype={selectedFiletype()}
                  syntaxStyle={syntax()}
                  showLineNumbers={true}
                  width="100%"
                  wrapMode="word"
                  fg={theme.text}
                  addedBg={theme.diffAddedBg}
                  removedBg={theme.diffRemovedBg}
                  contextBg={theme.diffContextBg}
                  addedSignColor={theme.diffHighlightAdded}
                  removedSignColor={theme.diffHighlightRemoved}
                  lineNumberFg={theme.diffLineNumber}
                  lineNumberBg={theme.diffContextBg}
                  addedLineNumberBg={theme.diffAddedLineNumberBg}
                  removedLineNumberBg={theme.diffRemovedLineNumberBg}
                />
              </box>
            </Show>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}
