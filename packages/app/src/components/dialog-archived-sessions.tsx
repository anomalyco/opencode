import { Component, createResource, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { sessionTitle } from "@/utils/session-title"
import type { Session } from "@opencode-ai/sdk/v2/client"

export const DialogArchivedSessions: Component = () => {
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const dialog = useDialog()

  const [archived] = createResource(async () => {
    const result = await sdk().client.session.list({ directory: sdk().directory })
    return (result.data ?? []).filter((s: Session) => !s.parentID && s.time?.archived)
      .sort((a: Session, b: Session) => (b.time.archived ?? 0) - (a.time.archived ?? 0))
  })

  return (
    <Dialog title="Archived Sessions" fit>
      <div class="flex flex-col gap-2 pl-6 pr-2.5 pb-3 min-w-72">
        <Show when={!archived.loading} fallback={<div class="flex justify-center py-4"><Spinner /></div>}>
          <For
            each={archived()}
            fallback={
              <span class="text-14-regular text-text-weak py-4">No archived sessions</span>
            }
          >
            {(session: Session) => (
              <Button
                variant="ghost"
                class="w-full text-left justify-start"
                onClick={() => {
                  const dir = base64Encode(session.directory)
                  navigate(`/${dir}/session/${session.id}`)
                  dialog.close()
                }}
              >
                <span class="truncate text-14-regular text-text-strong">
                  {sessionTitle(session.title) ?? ""}
                </span>
              </Button>
            )}
          </For>
        </Show>
        <div class="flex justify-end pt-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
