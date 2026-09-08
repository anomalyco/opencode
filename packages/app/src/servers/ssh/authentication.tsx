import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, Show, type ParentProps } from "solid-js"
import { useCurrentRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useSshServers } from "./context"
import { useSshReconnect } from "./reconnect"
import { createSshAuthentication } from "./authentication-state"
import { SshConnectionPanel } from "./connection-panel"

export function SshAuthentication(props: ParentProps) {
  const ssh = useSshServers()
  const route = useCurrentRoute()
  const tabs = useTabs()
  const dialog = useDialog()
  const reconnect = useSshReconnect()
  const item = createMemo(() => {
    const current = route()
    const key =
      current.type === "session"
        ? current.server
        : current.type === "draft"
          ? tabs.store.find((tab) => tab.type === "draft" && tab.draftID === current.draftID)?.server
          : undefined
    return ssh.data?.servers.find((item) => `ssh:${item.config.id}` === key && item.stage !== "ready")
  })
  createSshAuthentication({
    selection: () => {
      const current = route()
      if (current.type === "session") return `${current.server}:${current.sessionId}`
      if (current.type === "draft") return current.draftID
      return undefined
    },
    item,
    busy: () => !!dialog.active,
    open: (item) => reconnect.start(item.config),
  })
  return (
    <div class="relative flex size-full min-h-0 min-w-0 flex-col">
      {/* Keep the route mounted so reconnecting preserves its draft and local UI state. */}
      <div
        class="flex size-full min-h-0 min-w-0 flex-col"
        classList={{ invisible: !!item() }}
        inert={!!item()}
        aria-hidden={item() ? true : undefined}
      >
        {props.children}
      </div>
      <Show when={item()}>
        {(item) => (
          <div class="absolute inset-0">
            <SshConnectionPanel
              item={item()}
              pending={reconnect.pending(item().config.id)}
              onReconnect={() => reconnect.start(item().config)}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
