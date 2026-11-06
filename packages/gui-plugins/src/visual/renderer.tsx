import { CodeBlock, Style, type Plugin } from "@opencode/plugin/gui"
import type Visual from "./index"
import visualCSS from "./core/visual.css?inline"
import { parseVisual } from "./core/spec"
import { VisualView } from "./core/view"

const setup: Plugin.Setup<typeof Visual> = (ctx) => {
  ctx.add(Style, visualCSS)

  ctx.add(CodeBlock, {
    languages: ["visual", "genui"],
    render: (props) => {
      const parsed = parseVisual(props.code)

      if (!parsed.ok) return undefined

      return (
        <div class="vz-inline">
          <VisualView code={props.code} context="inline" />
        </div>
      )
    },
  })
}

export default setup
