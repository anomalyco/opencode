import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { base64Encode } from "@opencode-ai/util/encode"
import { DateTime } from "luxon"
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
        items={async () => {
          const result = await globalSDK.client.session.list({
            directory: props.project.worktree,
            archived: true,
          })
          return result.data ?? []
        }}
        key={(x) => x.id}
        onSelect={(session) => {
          if (session) restoreSession(session.id)
        }}
      >
        {(session) => (
          <div class="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-surface-raised-base-hover transition-colors text-left">
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
          </div>
        )}
      </List>
    </Dialog>
  )
}
