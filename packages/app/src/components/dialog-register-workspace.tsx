import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createStore } from "solid-js/store"
import { useHosted } from "@/context/hosted"

export function DialogRegisterWorkspace(props: { onCreated?: (path: string) => void }) {
  const dialog = useDialog()
  const hosted = useHosted()
  const [state, setState] = createStore({
    name: "",
    path: "",
    saving: false,
  })

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!state.path.trim()) return

    setState("saving", true)
    try {
      const workspace = await hosted.createWorkspace({
        name: state.name.trim() || undefined,
        path: state.path.trim(),
      })
      dialog.close()
      props.onCreated?.(workspace.path)
      showToast({
        title: "Workspace registered",
        description: workspace.name,
      })
    } catch (error) {
      showToast({
        title: "Failed to register workspace",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setState("saving", false)
    }
  }

  return (
    <Dialog title="Register shared workspace" class="w-full max-w-[520px] mx-auto">
      <form class="flex flex-col gap-4 p-6 pt-0" onSubmit={submit}>
        <div class="flex flex-col gap-1">
          <label class="text-12-medium text-text-weak">Name</label>
          <input
            type="text"
            value={state.name}
            onInput={(event) => setState("name", event.currentTarget.value)}
            placeholder="Team repo"
            class="h-10 rounded-lg border border-border-base bg-surface-base px-3 text-14-regular text-text-strong"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-12-medium text-text-weak">Path</label>
          <input
            type="text"
            value={state.path}
            onInput={(event) => setState("path", event.currentTarget.value)}
            placeholder="/workspaces/team-repo"
            class="h-10 rounded-lg border border-border-base bg-surface-base px-3 text-14-mono text-text-strong"
          />
          <div class="text-12-regular text-text-weak">
            The path must be a git workspace inside the configured workspaces root.
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.close()}
            class="h-10 rounded-lg px-4 text-14-medium text-text-weak hover:bg-surface-base-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={state.saving || !state.path.trim()}
            class="h-10 rounded-lg bg-surface-inverse-base px-4 text-14-medium text-text-inverse disabled:opacity-50"
          >
            {state.saving ? "Registering..." : "Register workspace"}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
