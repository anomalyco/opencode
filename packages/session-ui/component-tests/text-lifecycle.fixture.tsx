import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Typewriter } from "@opencode/ui/typewriter"

export function mountTextLifecycle() {
  const host = document.createElement("div")
  host.dataset.testid = "text-lifecycle-fixture"
  document.body.appendChild(host)
  const [text, setText] = createSignal<string | undefined>(undefined)
  const [active, setActive] = createSignal(true)

  render(
    () => (
      <>
        <Typewriter text={text()} as="p" />
        <TextShimmer text="Exploring" active={active()} />
      </>
    ),
    host,
  )

  const run = () => host.querySelector('[data-slot="text-shimmer-char-shimmer"]')!.getAttribute("data-run")

  return { setText, setActive, run }
}
