import { Plugin } from "@Mackery6969/plugin/tui"

// A slot that returns bare text next to a well-formed one (Mackery6969/opencode#58112).
export default Plugin.define({
  id: "fixture.slot-string",
  setup(context) {
    context.ui.slot({ append: "home.footer", render: () => "hello from a plugin" })
    context.ui.slot({ append: "home.footer", render: () => <text>Plugin still alive</text> })
  },
})
