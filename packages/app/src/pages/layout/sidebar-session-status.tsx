import { createMemo, Match, Switch, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { useGlobalSync } from "@/context/global-sync"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"

export const SessionStatusIndicator = (props: { session: Session }): JSX.Element => {
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const [store] = globalSync.child(props.session.directory)

  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(store.session, store.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    const status = store.session_status[props.session.id]
    return status?.type === "busy" || status?.type === "retry"
  })

  return (
    <Switch fallback={<Icon name="dash" size="small" class="text-icon-weak" />}>
      <Match when={isWorking()}>
        <Spinner class="size-[15px]" />
      </Match>
      <Match when={hasPermissions()}>
        <div class="size-1.5 rounded-full bg-surface-warning-strong" />
      </Match>
      <Match when={hasError()}>
        <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
      </Match>
      <Match when={unseenCount() > 0}>
        <div class="size-1.5 rounded-full bg-text-interactive-base" />
      </Match>
    </Switch>
  )
}
