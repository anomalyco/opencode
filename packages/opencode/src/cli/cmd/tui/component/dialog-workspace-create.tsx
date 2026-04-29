import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { createMemo, createSignal, onMount } from "solid-js"
import { setTimeout as sleep } from "node:timers/promises"
import { errorMessage } from "@/util/error"
import { useSDK } from "../context/sdk"
import { useI18n } from "../context/i18n"
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
  i18n: ReturnType<typeof useI18n>
  workspaceID: string
}) {
  const client = scoped(input.sdk, input.sync, input.workspaceID)

  while (true) {
    const result = await client.session.create({ workspace: input.workspaceID }).catch(() => undefined)
    if (!result) {
      input.toast.show({
        message: input.i18n.t("tui.dialog.workspace.session_failed"),
        variant: "error",
      })
      return
    }
    if (result.response?.status && result.response.status >= 500 && result.response.status < 600) {
      await sleep(1000)
      continue
    }
    if (!result.data) {
      input.toast.show({
        message: input.i18n.t("tui.dialog.workspace.session_failed"),
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

export async function restoreWorkspaceSession(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  project: ReturnType<typeof useProject>
  toast: ReturnType<typeof useToast>
  i18n: ReturnType<typeof useI18n>
  workspaceID: string
  sessionID: string
  done?: () => void
}) {
  const result = await input.sdk.client.experimental.workspace
    .sessionRestore({ id: input.workspaceID, sessionID: input.sessionID })
    .catch(() => undefined)
  if (!result?.data) {
    input.toast.show({
      message: `Failed to restore session: ${errorMessage(result?.error ?? "no response")}`,
      variant: "error",
    })
    return
  }

  input.project.workspace.set(input.workspaceID)

  await input.sync.bootstrap({ fatal: false }).catch(() => undefined)

  await Promise.all([input.project.workspace.sync(), input.sync.session.sync(input.sessionID)])

  input.toast.show({
    message: input.i18n.t("tui.dialog.workspace.restore_success"),
    variant: "success",
  })
  input.done?.()
  if (input.done) return
  input.dialog.clear()
}

export function DialogWorkspaceCreate(props: { onSelect: (workspaceID: string) => Promise<void> | void }) {
  const dialog = useDialog()
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const i18n = useI18n()
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
          message: i18n.t("tui.dialog.workspace.load_failed"),
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
          title: i18n.t("tui.dialog.workspace.creating", { type }),
          value: "creating" as const,
          description: i18n.t("tui.dialog.workspace.creating_description"),
        },
      ]
    }
    const list = adaptors()
    if (!list) {
      return [
        {
          title: i18n.t("tui.dialog.workspace.loading"),
          value: "loading" as const,
          description: i18n.t("tui.dialog.workspace.loading_description"),
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

    const result = await sdk.client.experimental.workspace.create({ type, branch: null }).catch(() => {
      toast.show({
        message: i18n.t("tui.dialog.workspace.create_failed"),
        variant: "error",
      })
      return undefined
    })

    const workspace = result?.data
    if (!workspace) {
      setCreating(undefined)
      toast.show({
        message: `${i18n.t("tui.dialog.workspace.create_failed")}: ${errorMessage(result?.error ?? "no response")}`,
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
      title={creating() ? i18n.t("tui.dialog.workspace.creating_title") : i18n.t("tui.dialog.workspace.title")}
      skipFilter={true}
      options={options()}
      onSelect={(option) => {
        if (option.value === "creating" || option.value === "loading") return
        void create(option.value)
      }}
    />
  )
}
