import { createMemo } from "solid-js"
import { useClipboard } from "../../context/clipboard"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"
import { abbreviateHome } from "../../util/path-format"
import { SessionQuestion } from "./permission"

export function SessionLocationMissing(props: { directory: string; onMove: () => void }) {
  const paths = useTuiPaths()
  const clipboard = useClipboard()
  const toast = useToast()
  const theme = useTheme("elevated")
  const directory = createMemo(() => Locale.truncateMiddle(abbreviateHome(props.directory, paths.home), 72))

  return (
    <SessionQuestion
      id="session.location-missing"
      group="Session recovery"
      choicesLabel="Recovery actions"
      instance={props.directory}
      title="Session directory no longer exists"
      body={
        <box paddingLeft={1} gap={1}>
          <text fg={theme.text.subdued}>{directory()}</text>
          <text fg={theme.text.default}>Move this session to continue.</text>
        </box>
      }
      options={{ move: "Move session", copy: "Copy path" }}
      onSelect={(option) => {
        if (option === "move") return props.onMove()
        void clipboard.write(props.directory)
        toast.show({ message: "Copied session directory", variant: "success" })
      }}
    />
  )
}
