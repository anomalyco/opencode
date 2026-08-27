import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { Markdown } from "../src/components/markdown"
import { preloadMarkdown } from "../src/components/markdown-cache"

export async function mountMarkdown(options: { text: string; streaming?: boolean; cached?: boolean }) {
  if (options.cached) await preloadMarkdown(options.text, "markdown-test")
  const host = document.createElement("div")
  host.dataset.testid = "markdown-fixture"
  document.body.appendChild(host)
  render(() => {
    const [text, setText] = createSignal(options.text)
    const [streaming, setStreaming] = createSignal(options.streaming ?? false)
    const [visible, setVisible] = createSignal(true)
    return (
      <>
        <textarea aria-label="Markdown text" value={text()} onInput={(event) => setText(event.currentTarget.value)} />
        <input
          aria-label="Streaming"
          type="checkbox"
          checked={streaming()}
          onChange={(event) => setStreaming(event.currentTarget.checked)}
        />
        <button onClick={() => setVisible((value) => !value)}>Toggle Markdown</button>
        <Show when={visible()}>
          <Markdown
            text={text()}
            streaming={streaming()}
            cacheKey={options.cached ? "markdown-test" : undefined}
            deferUntilReady
          />
        </Show>
      </>
    )
  }, host)
}
