import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.toggle-feedback",
  setup(context) {
    context.ui.slot({ append: "home.footer", render: () => <text>Toggle plugin active</text> })
  },
})
