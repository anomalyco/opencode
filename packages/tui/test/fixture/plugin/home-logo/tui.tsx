import { Plugin } from "@opencode/plugin/tui"

// Claims the Home wordmark slot, the smallest replacement a plugin can make.
export default Plugin.define({
  id: "fixture.home-logo",
  setup(context) {
    context.ui.slot({ replace: "home.logo", render: () => <text>Plugin home wordmark</text> })
  },
})
