import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.options-echo",
  setup(context) {
    context.ui.slot({ append: "home.footer", render: () => <text>Options {JSON.stringify(context.options)}</text> })
  },
})
