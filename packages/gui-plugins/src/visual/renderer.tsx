import { Show } from "solid-js"
import { CodeBlock, Style, type Plugin } from "@opencode/plugin/gui"
import type Visual from "./index"
import visualCSS from "./core/visual.css?inline"
import { VisualView } from "./core/view"

const setup: Plugin.Setup<typeof Visual> = (ctx) => {
  ctx.add(Style, visualCSS)

  ctx.add(CodeBlock, {
    languages: ["visual"],
    render: (props) => {
      const source = () => <ctx.ui.Code content={props.code} language={props.language} />

      return (
        <Show when={ctx.appearance.visualDisplay() !== "off"} fallback={source()}>
          <div class="vz-inline">
            <VisualView code={props.code} fallback={source()} />
          </div>
        </Show>
      )
    },
  })
}

export default setup
