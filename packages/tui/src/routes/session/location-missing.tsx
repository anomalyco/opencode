import { createMemo } from "solid-js"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { abbreviateHome } from "../../util/path-format"
import { SessionQuestion } from "./permission"
import { useDialog } from "../../ui/dialog"
import { useClient } from "../../context/client"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { DialogWorkspaces, type WorkspaceSelection } from "../../component/dialog-workspaces"
import { useData } from "../../context/data"

export function SessionLocationMissing(props: { directory: string; projectID: string; sessionID: string }) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const data = useData()

  function open() {
    dialog.replace(() => (
      <DialogWorkspaces
        projectID={props.projectID}
        location={{ directory: props.directory }}
        current={{
          type: "directory",
          directory: props.directory,
          subdirectory: !!data.session.get(props.sessionID)?.subpath,
        }}
        onSelect={(selection) => void select(selection)}
      />
    ))
  }

  async function select(selection: WorkspaceSelection) {
    dialog.clear()
    const directory =
      selection.type === "directory"
        ? selection.directory
        : await client.api.worktree
            .create({ projectID: props.projectID, name: selection.name })
            .then((result) => {
              if (!result.directory) throw new Error("No worktree directory returned")
              return result.directory
            })
            .catch((error) => {
              toast.show({ title: "Creating workspace failed", message: errorMessage(error), variant: "error" })
              return undefined
            })
    if (!directory) return
    await client.api.session.move({ sessionID: props.sessionID, directory }).catch((error) => {
      toast.show({ title: "Failed to move session", message: errorMessage(error), variant: "error" })
    })
  }

  return <SessionLocationUnavailable directory={props.directory} onMove={open} />
}

export function SessionLocationUnavailable(props: { directory: string; onMove: () => void }) {
  const paths = useTuiPaths()
  const theme = useTheme()
  const directory = createMemo(() => Locale.truncateMiddle(abbreviateHome(props.directory, paths.home), 72))

  return (
    <SessionQuestion
      id="session.location-missing"
      group="Session recovery"
      choicesLabel="Recovery actions"
      instance={props.directory}
      title="Session location unavailable"
      body={
        <box paddingLeft={1} gap={1}>
          <text fg={theme.text.muted}>{directory()}</text>
          <text fg={theme.text.base}>Choose another directory to continue this session.</text>
        </box>
      }
      options={{ move: "Choose directory" }}
      onSelect={props.onMove}
    />
  )
}
