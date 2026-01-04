import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate } from "@solidjs/router"

export function DialogViewArchivedSessions(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const navigate = useNavigate()

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
      <List
        search={{ placeholder: "Search archived sessions", autofocus: true }}
        emptyMessage="No archived sessions"
        items={async (filter: string) => {
          const result = await globalSDK.client.session.list({
            directory: props.project.worktree,
            archived: true,
          })
          return result.data ?? []
        }}
        filterKeys={["title"]}
        key={(x) => x.id}
        onSelect={(session) => {
          if (session) restoreSession(session.id)
        }}
      >
        {(session) => (
          <div class="w-full flex items-center justify-between rounded-md overflow-hidden">
            <div class="flex items-center gap-x-3 grow min-w-0 overflow-hidden">
              <Icon name="archive" size="small" class="text-text-weak shrink-0" />
              <div class="flex items-center text-14-regular overflow-hidden">
                <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                  {session.title}
                </span>
              </div>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
