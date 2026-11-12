import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, onCleanup, Show } from "solid-js"
import { DialogInbox, DialogInboxKey } from "../../component/dialog-inbox"
import { InboxSidebar } from "../../component/inbox-sidebar"
import { useConfig } from "../../config"
import { usePlugin } from "../../plugin/context"
import { useDialog } from "../../ui/dialog"
import { sessionInboxWidth } from "../../ui/layout"
import { useToast } from "../../ui/toast"

export default Plugin.define({
  id: "opencode.inbox",
  setup(context) {
    context.ui.slot({
      append: "workspace.rail",
      render(input) {
        const config = useConfig()
        const dialog = useDialog()
        const toast = useToast()
        const plugins = usePlugin()
        const dimensions = useTerminalDimensions()
        const sidebar = () => sessionInboxWidth(dimensions().width)
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
            <box width={Math.max(input.tabWidth, sidebar())} flexShrink={0}>
              <InboxSidebar />
            </box>
          </Show>
        )
      },
    })
  },
})
