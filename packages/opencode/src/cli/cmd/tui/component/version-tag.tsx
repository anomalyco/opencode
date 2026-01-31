import { createMemo, createSignal, onMount, Show } from "solid-js"
import { Installation } from "@/installation"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "@tui/component/dialog-command"
import { getReleaseNotes } from "@tui/util/changelog"

export type VersionTagProps = {
  version?: string
}

export function VersionTag(props: VersionTagProps) {
  const { theme } = useTheme()
  const command = useCommandDialog()
  const version = () => props.version ?? Installation.VERSION

  const [hasChangelog, setHasChangelog] = createSignal(false)

  onMount(async () => {
    const notes = await getReleaseNotes(version())
    setHasChangelog(notes !== null && notes.trim().length > 0)
  })

  const [hover, setHover] = createSignal(false)
  const textStyle = createMemo(() => ({
    fg: hover() && hasChangelog() ? theme.text : theme.textMuted,
    underline: hover() && hasChangelog(),
  }))

  return (
    <Show when={hasChangelog()} fallback={<text fg={theme.textMuted}>{version()}</text>}>
      <text
        fg={textStyle().fg}
        style={textStyle()}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => command.trigger("changelog.show")}
      >
        {version()}
      </text>
    </Show>
  )
}
