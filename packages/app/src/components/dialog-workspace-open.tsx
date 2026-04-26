import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { useNavigate } from "@solidjs/router"
import { createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useWorkspace } from "@/context/workspace"
import { base64Encode } from "@opencode-ai/core/util/encode"

type WorkspaceFolder = {
  path: string
  name?: string
}

type Workspace = {
  id: string
  name: string
  filePath: string
  folders: WorkspaceFolder[]
  time: {
    created: number
    updated: number
  }
}

export function DialogWorkspaceOpen() {
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const globalSdk = useGlobalSDK()

  const [workspaces, { refetch }] = createResource(async () => {
    return await globalSdk.client.workspace.list().then((result) => result.data ?? [])
  })

  const deleteMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      await globalSdk.client.workspace.delete({ id })
    },
    onSuccess: () => {
      setStore("confirmingDelete", null)
      refetch()
    },
  }))

  const [store, setStore] = createStore({
    confirmingDelete: null as string | null,
  })

  const handleOpen = async (ws: Workspace) => {
    if (!ws.folders.length) return
    dialog.close()
    await workspace.workspaces.open(ws.id)
    const firstFolder = ws.folders[0]
    if (firstFolder) {
      navigate(`/${base64Encode(firstFolder.path)}/session`)
    }
  }

  const handleDeleteClick = (id: string) => {
    if (store.confirmingDelete === id) {
      deleteMutation.mutate(id)
      return
    }
    setStore("confirmingDelete", id)
  }

  const handleCancelDelete = () => {
    setStore("confirmingDelete", null)
  }

  return (
    <Dialog title={language.t("dialog.workspace.open.title")}>
      <Show
        when={!workspaces.loading}
        fallback={
          <div class="flex items-center justify-center p-8 text-14-regular text-text-weak">
            {language.t("common.loading")}
          </div>
        }
      >
        <Show
          when={!workspaces.error}
          fallback={
            <div class="flex items-center justify-center p-8 text-14-regular text-text-weak">
              {language.t("common.error")}
            </div>
          }
        >
        <List<Workspace>
          search={{
            placeholder: language.t("dialog.workspace.search.placeholder"),
            autofocus: true,
          }}
          emptyMessage={language.t("dialog.workspace.empty")}
          items={workspaces() ?? []}
          key={(x) => x.id}
          filterKeys={["name"]}
          onSelect={(ws) => {
            if (!ws) return
            void handleOpen(ws)
          }}
        >
          {(ws) => {
            const count = ws.folders.length
            const isConfirming = store.confirmingDelete === ws.id
            const isDeleting =
              deleteMutation.isPending && store.confirmingDelete === ws.id

            return (
              <div class="w-full flex items-center justify-between gap-x-3">
                <div class="flex flex-col min-w-0">
                  <span class="text-14-regular text-text-strong truncate">
                    {ws.name}
                  </span>
                  <Show when={count > 0}>
                    <span class="text-12-regular text-text-weak">
                      {language.t("dialog.workspace.folders", {
                        count: String(count),
                      })}
                    </span>
                  </Show>
                </div>
                <Show
                  when={!isConfirming}
                  fallback={
                    <div
                      class="flex items-center gap-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span class="text-12-regular text-text-weak whitespace-nowrap">
                        {language.t("dialog.workspace.delete.confirm")}
                      </span>
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={handleCancelDelete}
                      >
                        {language.t("common.cancel")}
                      </Button>
                      <Button
                        variant="primary"
                        size="small"
                        disabled={isDeleting}
                        onClick={() => handleDeleteClick(ws.id)}
                      >
                        {language.t("common.delete")}
                      </Button>
                    </div>
                  }
                >
                  <div
                    class="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => handleOpen(ws)}
                      disabled={count === 0}
                    >
                      {language.t("dialog.workspace.open.button")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => handleDeleteClick(ws.id)}
                    >
                      <Icon
                        name="trash"
                        size="small"
                        class="text-icon-weak"
                      />
                    </Button>
                  </div>
                </Show>
              </div>
            )
          }}
        </List>
        </Show>
      </Show>
    </Dialog>
  )
}
