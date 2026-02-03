import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeyboard } from "@opentui/solid"
import type { Snapshot } from "@/snapshot"
import path from "path"

type GroupedFiles = {
  directory: string
  files: { file: Snapshot.FileDiff; index: number; name: string }[]
}

function truncateDirectory(dir: string, maxSegments = 3): string {
  const segments = dir.split("/").filter(Boolean)
  if (segments.length <= maxSegments) return dir
  return "…/" + segments.slice(-maxSegments).join("/")
}

function groupFilesByDirectory(files: Snapshot.FileDiff[]): GroupedFiles[] {
  const groups = new Map<string, { file: Snapshot.FileDiff; index: number; name: string }[]>()

  files.forEach((file, index) => {
    const dir = path.dirname(file.file)
    const name = path.basename(file.file)
    if (!groups.has(dir)) {
      groups.set(dir, [])
    }
    groups.get(dir)!.push({ file, index, name })
  })

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, files]) => ({ directory: truncateDirectory(directory), files }))
}

export function FileList(props: {
  files: Snapshot.FileDiff[]
  selected: number
  onSelect: (index: number) => void
  onSwitch?: () => void
  width: number
  focused: boolean
}) {
  const { theme } = useTheme()

  const grouped = createMemo(() => groupFilesByDirectory(props.files))

  useKeyboard((evt) => {
    if (!props.focused) return

    if ((evt.name === "j" || evt.name === "down") && props.selected < props.files.length - 1) {
      props.onSelect(props.selected + 1)
    }
    if ((evt.name === "k" || evt.name === "up") && props.selected > 0) {
      props.onSelect(props.selected - 1)
    }
    if (evt.name === "return") {
      props.onSwitch?.()
    }
  })

  return (
    <box width={props.width} height="100%">
      <scrollbox flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} scrollbarOptions={{ visible: false }}>
        <box gap={0}>
          <text fg={theme.text}>
            <b>Modified Files</b> ({props.files.length})
          </text>
          <box height={1} />
          <Show when={props.files.length > 0} fallback={<text fg={theme.textMuted}>No files modified</text>}>
            <For each={grouped()}>
              {(group) => (
                <box gap={0}>
                  <text fg={theme.textMuted}>{group.directory}/</text>
                  <For each={group.files}>
                    {(item) => (
                      <box
                        flexDirection="row"
                        gap={1}
                        justifyContent="space-between"
                        backgroundColor={item.index === props.selected ? theme.backgroundElement : undefined}
                        paddingLeft={2}
                        paddingRight={1}
                        onMouseDown={() => props.onSelect(item.index)}
                      >
                        <text fg={theme.text} wrapMode="none" flexShrink={1}>
                          {item.name}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={0}>
                          <Show when={item.file.additions}>
                            <text fg={theme.diffAdded}>+{item.file.additions}</text>
                          </Show>
                          <Show when={item.file.deletions}>
                            <text fg={theme.diffRemoved}>-{item.file.deletions}</text>
                          </Show>
                        </box>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}
