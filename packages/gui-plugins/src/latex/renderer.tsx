import { CodeBlock, type Plugin } from "@opencode/plugin/gui"
import type Latex from "./index"
import { latexLanguages, renderLatex } from "./render"

/** Draws ```` ```latex ```` and ```` ```math ```` fences as display math, as the TUI does. */
const setup: Plugin.Setup<typeof Latex> = (ctx) => {
  ctx.add(CodeBlock, {
    languages: latexLanguages,
    render: (props) => {
      const html = renderLatex(props.code)

      if (!html) return

      return <div style={{ "overflow-x": "auto", "overflow-y": "hidden" }} innerHTML={html} />
    },
  })
}

export default setup
