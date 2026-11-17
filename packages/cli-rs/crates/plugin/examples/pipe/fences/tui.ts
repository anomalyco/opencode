// Contract 2.x, step D: code-block renderers on the JS host, through the V2 compatibility layer, as a `{ id, setup }`
// module written against `@opencode/plugin/tui`, as an npm plugin is. Each language is a behavior a row of
// `plugin_fences.rs` checks:
//
// - `probe`: good-fences' shape, a box of a label (`| <lang> (<n>)`, numbered by render) and the host's own code
//   view in the raised color;
// - `boom`: throws; `nope`: declines; `asks`: asks the host for a toast as it draws, then shows the code view alone;
// - `hang`: never returns, so the JS host stops answering;
// - with the option `many`, as many more languages `x0`, `x1`, …, each declining.
import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, TextRenderable } from "@opentui/core"

export default Plugin.define({
  id: "example.fences",
  setup(context: any) {
    const raised = context.theme.background.raised.base
    let renders = 0
    context.markdown.registerCodeBlockRenderer("probe", (token: any, cx: any) => {
      const inner = cx.defaultRender()
      inner.bg = raised
      const box = new BoxRenderable(context.renderer, {
        flexDirection: "column",
        backgroundColor: raised,
        paddingLeft: 2,
      })
      box.add(new TextRenderable(context.renderer, { content: `| ${token.lang} (${++renders})` }))
      box.add(inner)
      return box
    })
    context.markdown.registerCodeBlockRenderer("boom", () => {
      throw new Error("boom")
    })
    context.markdown.registerCodeBlockRenderer("nope", () => undefined)
    context.markdown.registerCodeBlockRenderer("asks", (_token: any, cx: any) => {
      context.ui.toast.show({ message: "asked as it drew" })
      return cx.defaultRender()
    })
    context.markdown.registerCodeBlockRenderer("hang", () => {
      for (;;) {}
    })
    for (let index = 0; index < (context.options.many ?? 0); index++)
      context.markdown.registerCodeBlockRenderer(`x${index}`, () => undefined)
  },
})
