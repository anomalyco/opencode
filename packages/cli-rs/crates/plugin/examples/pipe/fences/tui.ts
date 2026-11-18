// Tests code-block renderers through the public V2 plugin context. Each language selects a distinct renderer
// behavior.
//
// - `probe`: good-fences' shape, a box of a label (`| <lang> (<n>)`, numbered by render) and the host's own code
//   view in the raised color;
// - `boom`: throws; `nope`: declines; `asks`: asks the host for a toast as it draws, then shows the code view alone;
// - `twice`: a tree with two fence nodes, which the host refuses;
// - `hang`: never returns, so the JS host stops answering;
// - the command `fences.late` registers a renderer of `late` after setup, which reloads the plugin's registrations;
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
    context.markdown.registerCodeBlockRenderer("twice", (_token: any, cx: any) => {
      const box = new BoxRenderable(context.renderer, { flexDirection: "column" })
      box.add(cx.defaultRender())
      box.add(cx.defaultRender())
      return box
    })
    context.markdown.registerCodeBlockRenderer("asks", (_token: any, cx: any) => {
      context.ui.toast.show({ message: "asked as it drew" })
      return cx.defaultRender()
    })
    context.markdown.registerCodeBlockRenderer("hang", () => {
      for (;;) {}
    })
    context.keymap.layer(() => ({
      commands: [{ id: "fences.late", run: () => void context.markdown.registerCodeBlockRenderer("late", () => undefined) }],
    }))
    for (let index = 0; index < (context.options.many ?? 0); index++)
      context.markdown.registerCodeBlockRenderer(`x${index}`, () => undefined)
  },
})
