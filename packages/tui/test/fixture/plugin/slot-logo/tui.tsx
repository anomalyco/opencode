import { Plugin } from "@opencode/plugin/tui"

// Replaces the home screen logo (anomalyco/opencode#51916).
export default Plugin.define({
  id: "fixture.slot-logo",
  setup(context) {
    context.ui.slot({ replace: "home.logo", render: () => <text>ACME CODE</text> })
  },
})
