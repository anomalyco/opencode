import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { Markdown } from "../src/components/markdown"
import { preloadMarkdown } from "../src/components/markdown-cache"
import { MarkdownProvider } from "../src/context/markdown"
import { OpenCode } from "@opencode-ai/client/promise"
import { readLocalImage } from "../../app/src/runtime/server/image"

export {
  getCachedMarkdown,
  renderCachedMarkdown,
  sanitizeMarkdown,
  touchCachedMarkdown,
} from "../src/components/markdown-cache"
export { renderMermaidSvg } from "../src/components/markdown-mermaid"

export async function mountMarkdown(options: {
  text: string
  streaming?: boolean
  cached?: boolean
  images?: boolean
}) {
  if (options.cached) await preloadMarkdown(options.text, "markdown-test")
  const host = document.createElement("div")
  host.dataset.testid = "markdown-fixture"
  document.body.appendChild(host)
  render(() => {
    const api = OpenCode.make({
      baseUrl: location.origin,
      headers: { Authorization: `Basic ${btoa("opencode:fixture")}` },
    })
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
        <MarkdownProvider
          readImage={(path, signal) =>
            options.images ? readLocalImage(api, "C:/project", path, signal) : Promise.resolve(undefined)
          }
        >
          <Show when={visible()}>
            <Markdown
              text={text()}
              streaming={streaming()}
              cacheKey={options.cached ? "markdown-test" : undefined}
              deferUntilReady
            />
          </Show>
        </MarkdownProvider>
      </>
    )
  }, host)
}
