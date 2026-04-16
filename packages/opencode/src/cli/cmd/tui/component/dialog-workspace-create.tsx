import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { createMemo, createSignal, onMount } from "solid-js"
import { setTimeout as sleep } from "node:timers/promises"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

type Adaptor = {
  type: string
  name: string
  description: string
}

function scoped(sdk: ReturnType<typeof useSDK>, sync: ReturnType<typeof useSync>, workspaceID: string) {
  return createOpencodeClient({
    baseUrl: sdk.url,
    fetch: sdk.fetch,
    directory: sync.path.directory || sdk.directory,
    experimental_workspaceID: workspaceID,
  })
}

export async function openWorkspaceSession(input: {
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  workspaceID: string
}) {
  const client = scoped(input.sdk, input.sync, input.workspaceID)
  while (true) {
    const result = await client.session.create({ workspaceID: input.workspaceID }).catch(() => undefined)
    if (!result) {
      input.toast.show({
        message: "Failed to create workspace session",
        variant: "error",
      })
      return
    }
    if (result.response.status >= 500 && result.response.status < 600) {
      await sleep(1000)
      continue
    }
    if (!result.data) {
      input.toast.show({
        message: "Failed to create workspace session",
        variant: "error",
      })
      return
    }
    input.route.navigate({
      type: "session",
      sessionID: result.data.id,
    })
    input.dialog.clear()
    return
  }
}

export function DialogWorkspaceCreate(props: { onSelect: (workspaceID: string) => Promise<void> | void }) {
  const dialog = useDialog()
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const [creating, setCreating] = createSignal<string>()
  const [adaptors, setAdaptors] = createSignal<Adaptor[]>()

  onMount(() => {
    dialog.setSize("medium")
    void (async () => {
      const dir = sync.path.directory || sdk.directory
      const url = new URL("/experimental/workspace/adaptor", sdk.url)
      if (dir) url.searchParams.set("directory", dir)
      const res = await sdk
        .fetch(url)
        .then((x) => x.json() as Promise<Adaptor[]>)
        .catch(() => undefined)
      if (!res) {
        toast.show({
          message: "Failed to load workspace adaptors",
          variant: "error",
        })
        return
      }
      setAdaptors(res)
    })()
  })

  const options = createMemo(() => {
    const type = creating()
    if (type) {
      return [
        {
          title: `Creating ${type} workspace...`,
          value: "creating" as const,
          description: "This can take a while for remote environments",
        },
      ]
    }
    const list = adaptors()
    if (!list) {
      return [
        {
          title: "Loading workspaces...",
          value: "loading" as const,
          description: "Fetching available workspace adaptors",
        },
      ]
    }
    return list.map((item) => ({
      title: item.name,
      value: item.type,
      description: item.description,
    }))
  })

  const create = async (type: string) => {
    if (creating()) return
    setCreating(type)

    const result = await sdk.client.experimental.workspace.create({ type, branch: null }).catch(() => undefined)
    const workspace = result?.data
    if (!workspace) {
      setCreating(undefined)
      toast.show({
        message: "Failed to create workspace",
        variant: "error",
      })
      return
    }
    await project.workspace.sync()
    await props.onSelect(workspace.id)
    setCreating(undefined)
  }

  return (
    <DialogSelect
      title={creating() ? "Creating Workspace" : "New Workspace"}
      skipFilter={true}
      options={options()}
      onSelect={(option) => {
        if (option.value === "creating" || option.value === "loading") return
        void create(option.value)
      }}
    />
  )
}
