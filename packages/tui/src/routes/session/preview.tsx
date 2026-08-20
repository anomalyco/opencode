import path from "node:path"
import { createMemo, createResource, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTuiConfig } from "../../config"
import { useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"
import { Locale } from "../../util/locale"
import { getScrollAcceleration } from "../../util/scroll"

export function PreviewPanel(props: {
  file: () => string
  directory: () => string | undefined
  width: () => number
  overlay?: boolean
}) {
  const { theme, syntax } = useTheme()
  const tuiConfig = useTuiConfig()
  const toggleShortcut = useCommandShortcut("session.preview.toggle")
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const [content] = createResource(
    () => props.file(),
    (file) =>
      Bun.file(file)
        .text()
        .then((text) => ({ content: text }) as const)
        .catch(() => ({ error: true }) as const),
  )

  const text = createMemo(() => {
    const result = content()
    if (!result || !("content" in result)) return
    return result.content
  })

  const title = createMemo(() => {
    const directory = props.directory()
    const file = props.file()
    if (!directory) return file
    const relative = path.relative(directory, file)
    if (relative.startsWith("..")) return file
    return relative
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={props.width()}
      height="100%"
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
    >
      <box flexShrink={0} paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {Locale.truncateLeft(title(), props.width() - 5)}
        </text>
      </box>
      <Show
        when={content.state !== "pending"}
        fallback={
          <box flexGrow={1}>
            <text fg={theme.textMuted}>Loading…</text>
          </box>
        }
      >
        <Show
          when={text() !== undefined}
          fallback={
            <box flexGrow={1}>
              <text fg={theme.textMuted}>Unable to read file</text>
            </box>
          }
        >
          <scrollbox
            flexGrow={1}
            scrollAcceleration={scrollAcceleration()}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <markdown
              syntaxStyle={syntax()}
              streaming={false}
              internalBlockMode="top-level"
              tableOptions={{ style: "grid" }}
              conceal={false}
              content={text() ?? ""}
              fg={theme.markdownText}
              bg={theme.backgroundPanel}
            />
          </scrollbox>
        </Show>
      </Show>
      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{toggleShortcut() || "/preview"}</span> to close
        </text>
      </box>
    </box>
  )
}
