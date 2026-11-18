import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { ToolStatusTitle } from "../src/components/tool-status-title"

export function mountToolStatusTitle() {
  const host = document.createElement("div")
  host.dataset.testid = "tool-status-title-fixture"
  document.body.appendChild(host)
  const [active, setActive] = createSignal(true)
  const [hidden, setHidden] = createSignal(false)

  render(
    () => (
      <div style={{ display: hidden() ? "none" : "block" }}>
        <ToolStatusTitle active={active()} activeText="Exploring" doneText="Explored" split={false} />
      </div>
    ),
    host,
  )

  return { setActive, setHidden }
}
