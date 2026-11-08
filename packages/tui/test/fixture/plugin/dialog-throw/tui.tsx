import { Plugin } from "@Mackery6969/plugin/tui"

// A dialog that throws while rendering (Mackery6969/opencode#61101).
export default Plugin.define({
  id: "fixture.dialog-throw",
  setup(context) {
    context.ui.dialog.show(() => {
      throw new Error("dialog exploded")
    })
  },
})
