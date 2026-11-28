import { Plugin } from "@opencode/plugin/tui"
import { createEffect, onCleanup } from "solid-js"
import { DialogInbox, DialogInboxKey } from "../../component/dialog-inbox"
import { useConfig } from "../../config"
import { usePlugin } from "../../plugin/context"
import { useDialog } from "../../ui/dialog"

export default Plugin.define({
  id: "opencode.inbox",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const config = useConfig()
        const dialog = useDialog()
        const plugins = usePlugin()
        const open = () => dialog.replace(() => <DialogInbox />, undefined, { key: DialogInboxKey, drawer: true })

        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.inbox.toggle",
              title: "Open Inbox",
              group: "Inbox",
              palette: true,
              run: () => (dialog.key === DialogInboxKey ? dialog.clear() : open()),
            },
          ],
        }))
        let checked = false
        createEffect(() => {
          if (checked || !plugins.ready()) return
          checked = true
          if (config.data.session.inbox && !dialog.stack.length) open()
        })
        onCleanup(() => {
          if (dialog.key === DialogInboxKey) dialog.clear()
        })
        return null
      },
    })
  },
})
