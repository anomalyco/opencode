import { Plugin } from "@opencode/plugin/tui"

// A slot that returns bare text next to a well-formed one (anomalyco/opencode#58112).
export default Plugin.define({
  id: "fixture.slot-string",
  setup(context) {
    context.ui.slot({ append: "home.footer", render: () => "hello from a plugin" })
    context.ui.slot({ append: "home.footer", render: () => <text>Plugin still alive</text> })
  },
})
