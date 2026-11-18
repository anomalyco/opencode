import { Plugin } from "@opencode/plugin/tui"

// Reads messages through the plugin client, whose files must stay inline bytes.
export default Plugin.define({
  id: "fixture.client-reads",
  setup(context) {
    void context.client.message.list({ sessionID: "ses_plugin_probe" })
  },
})
