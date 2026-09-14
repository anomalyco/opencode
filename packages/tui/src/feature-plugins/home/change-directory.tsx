import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, Show } from "solid-js"
import { reconcile } from "solid-js/store"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useToast } from "../../ui/toast"
import { useDialog } from "../../ui/dialog"
import { errorMessage } from "../../util/error"
import { useProject } from "../../context/project"
import { useRoute } from "../../context/route"
import path from "path"

const id = "change-directory"

function ChangeDirectoryDialog(props: { api: TuiPluginApi }) {
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const dialog = useDialog()
  const project = useProject()
  const route = useRoute()
  const [input, setInput] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const currentDir = () => project.instance.directory() ?? ""

  async function submit() {
    const target = input().trim()
    if (!target) return
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    if (!sessionID) {
      toast.show({ title: "No active session", message: "Open a session before changing directory", variant: "error" })
      return
    }
    const resolved = path.isAbsolute(target) ? target : path.resolve(currentDir(), target)
    setBusy(true)
    try {
      await sdk.client.experimental.controlPlane.moveSession(
        {
          sessionID,
          destination: { directory: resolved },
          moveChanges: false,
        },
        { throwOnError: true },
      )
      // Non-critical: the move succeeded; a failed reminder doesn't warrant a user-facing error
      await sdk.client.session
        .promptAsync({
          sessionID,
          directory: resolved,
          noReply: true,
          parts: [
            {
              type: "text",
              text: `<system-reminder>The user has changed the working directory to "${target}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`,
              synthetic: true,
            },
          ],
        })
        .catch((err) => {
          toast.show({ title: "Directory changed", message: `${resolved} (agent notification failed: ${errorMessage(err)})`, variant: "warning" })
        })
      const res = await sdk.client.vcs.get({ workspace: project.workspace.current() })
      if (res.data) sync.set("vcs", reconcile(res.data))
      toast.show({ title: "Changed directory", message: resolved, variant: "success" })
      dialog.clear()
    } catch (err) {
      toast.show({ title: "Failed to change directory", message: errorMessage(err), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={props.api.theme.current.text}>Change working directory</text>
      <text fg={props.api.theme.current.textMuted}>Current: {currentDir()}</text>
      <text fg={props.api.theme.current.textMuted}>Uncommitted changes will not follow the session.</text>
      <box flexDirection="row" gap={1}>
        <text fg={props.api.theme.current.text}>{">"}</text>
        <input
          value={input()}
          onInput={(value) => setInput(value)}
          onSubmit={() => void submit()}
          placeholder="/path/to/worktree"
        />
      </box>
      <box flexDirection="row" gap={2}>
        <Show when={!busy()}>
          <text fg={props.api.theme.current.accent}>Enter to confirm</text>
        </Show>
        <Show when={busy()}>
          <text fg={props.api.theme.current.textMuted}>Moving...</text>
        </Show>
        <text fg={props.api.theme.current.textMuted}>Esc to cancel</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "cd.open",
        title: "Change directory",
        slashName: "cd",
        category: "Session",
        namespace: "palette",
        run() {
          api.ui.dialog.replace(() => <ChangeDirectoryDialog api={api} />)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
