import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, onCleanup, Show } from "solid-js"
import { DialogInbox, DialogInboxKey } from "../../component/dialog-inbox"
import { InboxSidebar } from "../../component/inbox-sidebar"
import { useConfig } from "../../config"
import { usePlugin } from "../../plugin/context"
import { useDialog } from "../../ui/dialog"
import { INBOX_SIDEBAR_WIDTH, sessionInboxWidth } from "../../ui/layout"
import { createPaneResize } from "../../ui/pane-resize"
import { PaneResizeHandle } from "../../ui/pane-resize-handle"
import { useToast } from "../../ui/toast"

export default Plugin.define({
  id: "opencode.inbox",
  setup(context) {
    context.ui.slot({
      append: "workspace.rail",
      render() {
        const config = useConfig()
        const dialog = useDialog()
        const toast = useToast()
        const plugins = usePlugin()
        const dimensions = useTerminalDimensions()
        const [layout, updateLayout] = context.storage.store<{ inboxWidth?: number }>("layout", {
          initial: { inboxWidth: INBOX_SIDEBAR_WIDTH },
        })
        let rail: BoxRenderable | undefined
        const resize = createPaneResize({
          value: () => layout.inboxWidth ?? INBOX_SIDEBAR_WIDTH,
          defaultValue: () => INBOX_SIDEBAR_WIDTH,
          clamp: (width) => sessionInboxWidth(dimensions().width, width),
          fromMouse: (event) => event.x - (rail?.screenX ?? 0) + 1,
          contains: (event, width) => {
            const x = event.x - (rail?.screenX ?? 0)
            return x >= width - 1 && x <= width
          },
          onCommit: (width) => {
            void updateLayout((draft) => {
              draft.inboxWidth = width
            }).catch(toast.error)
          },
        })
        const sidebar = resize.size
        const drawer = () => config.data.session.inbox_layout === "side-overlay" || sidebar() === 0
        const open = () => dialog.replace(() => <DialogInbox />, undefined, { key: DialogInboxKey, drawer: true })

        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.inbox.toggle",
              title: drawer() ? "Open Inbox" : config.data.session.inbox ? "Hide Inbox sidebar" : "Show Inbox sidebar",
              group: "Inbox",
              palette: true,
              run() {
                if (dialog.key === DialogInboxKey) return dialog.clear()
                if (drawer()) return open()
                void config
                  .update((draft) => {
                    draft.session = { ...draft.session, inbox: !config.data.session.inbox }
                  })
                  .catch(toast.error)
              },
            },
          ],
        }))
        let checked = false
        createEffect(() => {
          if (checked || !plugins.ready()) return
          checked = true
          if (config.data.session.inbox && config.data.session.inbox_layout === "side-overlay" && !dialog.stack.length)
            open()
        })
        onCleanup(() => {
          if (dialog.key === DialogInboxKey) dialog.clear()
        })
        return (
          <Show when={config.data.session.inbox && !drawer()}>
            <box
              ref={(node) => (rail = node)}
              width={sidebar()}
              flexShrink={0}
              position="relative"
              onMouseDrag={resize.onMouseDrag}
              onMouseDragEnd={resize.onMouseDragEnd}
              onMouseUp={resize.onMouseUp}
            >
              <InboxSidebar />
              <PaneResizeHandle resize={resize} left={sidebar() - 1} />
            </box>
          </Show>
        )
      },
    })
  },
})
