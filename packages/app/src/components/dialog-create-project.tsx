import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { errorMessage } from "@/pages/layout/helpers"

export function DialogCreateProject(props: { onCreate: (directory: string) => void }) {
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    name: "",
    saving: false,
  })

  const canSubmit = createMemo(() => store.name.trim().length > 0 && !store.saving)

  async function request(name: string) {
    const current = server.current
    if (!current) throw new Error("No server available")

    const headers = new Headers({ "content-type": "application/json" })
    if (current.http.password) {
      headers.set("Authorization", `Basic ${btoa(`${current.http.username ?? "opencode"}:${current.http.password}`)}`)
    }

    const response = await (platform.fetch ?? fetch)(`${current.http.url}/project/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    })

    const payload = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw new Error(
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `Request failed (${response.status})`,
      )
    }

    const directory =
      payload && typeof payload === "object" && "directory" in payload && typeof payload.directory === "string"
        ? payload.directory
        : undefined
    if (!directory) throw new Error("Project creation returned no directory")
    return directory
  }

  async function submit() {
    const name = store.name.trim()
    if (!name || store.saving) return

    setStore("saving", true)
    try {
      const directory = await request(name)
      dialog.close()
      props.onCreate(directory)
    } catch (err) {
      showToast({
        variant: "error",
        title: "Couldn't create project",
        description: errorMessage(err, "Something went wrong while creating the project."),
      })
    } finally {
      setStore("saving", false)
    }
  }

  return (
    <Dialog title="Create a new project" fit>
      <div class="flex flex-col gap-4 px-6 pb-4">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">Give your project a simple name.</span>
          <span class="text-12-regular text-text-weak">We'll create the folder and open it for you.</span>
        </div>
        <TextField
          autofocus
          type="text"
          label="Project name"
          placeholder="Market analysis"
          value={store.name}
          disabled={store.saving}
          onChange={(value) => setStore("name", value)}
          onKeyDown={(event: KeyboardEvent) => {
            event.stopPropagation()
            if (event.key === "Escape") {
              event.preventDefault()
              dialog.close()
              return
            }
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            void submit()
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" size="large" disabled={!canSubmit()} onClick={() => void submit()}>
            {store.saving ? "Creating..." : "Create project"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
