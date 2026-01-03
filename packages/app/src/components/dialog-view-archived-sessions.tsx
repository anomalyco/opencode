import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createResource, For, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { base64Encode } from "@opencode-ai/util/encode"
import { DateTime } from "luxon"
import { useNavigate } from "@solidjs/router"

export function DialogViewArchivedSessions(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const navigate = useNavigate()

  const [archivedSessions] = createResource(async () => {
    const result = await globalSDK.client.session.list({
      directory: props.project.worktree,
      archived: true,
    })
    return result.data ?? []
  })

  async function restoreSession(sessionID: string) {
    await globalSDK.client.session.update({
      directory: props.project.worktree,
      sessionID,
      time: { archived: undefined },
    })
    navigate(`/${base64Encode(props.project.worktree)}/session/${sessionID}`)
    dialog.close()
  }

  return (
    <Dialog title="Archived Sessions">
      <div class="flex flex-col gap-4 px-2.5 pb-3 min-w-[400px] max-h-[60vh] overflow-y-auto">
        <Show
          when={archivedSessions.loading}
          fallback={
            <Show when={archivedSessions()?.length === 0}>
              <div class="text-center py-8 text-text-weak">No archived sessions</div>
            </Show>
          }
        >
          <div class="flex items-center justify-center py-8">
            <Spinner />
          </div>
        </Show>
        <Show when={archivedSessions() && archivedSessions()!.length > 0}>
          <div class="flex flex-col gap-2">
            <For each={archivedSessions()}>
              {(session) => (
                <button
                  class="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-surface-raised-base-hover transition-colors text-left"
                  onClick={() => restoreSession(session.id)}
                >
                  <Icon name="archive" size="small" class="text-text-weak shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="text-14-medium text-text-strong truncate">{session.title}</div>
                    <div class="text-12-regular text-text-weak">
                      {DateTime.fromMillis(session.time.archived ?? session.time.updated).toLocaleString(
                        DateTime.DATETIME_MED,
                      )}
                    </div>
                  </div>
                  <Icon name="chevron-right" size="small" class="text-text-weak shrink-0" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
