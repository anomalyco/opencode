import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { OpenCode } from "@opencode-ai/client/promise"
import { readLocalImage } from "../../app/src/runtime/server/image"
import { MarkdownProvider } from "../src/context/markdown"
import { CurrentSessionProviders } from "../src/storybook/current-session-story"
import { storyDocument, storyTool } from "../src/storybook/current-session-scenarios"
import { CurrentContextToolGroup, ToolDisplay } from "../src/tools/tool-renderer"

export function mountReadImage(options: { path: string; grouped: boolean; running?: boolean }) {
  const host = document.createElement("div")
  host.dataset.testid = "read-image-fixture"
  document.body.appendChild(host)
  render(() => {
    const api = OpenCode.make({
      baseUrl: location.origin,
      headers: { Authorization: `Basic ${btoa("opencode:fixture")}` },
    })
    const [state, setState] = createStore({ open: true, visible: true, running: !!options.running, appended: false })
    const status = () => (state.running ? "running" : "completed")
    const tools = createMemo(() => [
      storyTool("read_image", "read", status(), { path: options.path }),
      storyTool("read_text", "read", "completed", { path: "src/example.ts", limit: 20 }),
      ...(state.appended ? [storyTool("read_next", "read", "completed", { path: "src/next.ts" })] : []),
    ])
    return (
      <section style={{ "max-width": "720px", padding: "24px" }}>
        <button onClick={() => setState("running", false)}>Finish read</button>
        <button onClick={() => setState("appended", true)}>Append read</button>
        <button onClick={() => setState("visible", false)}>Unmount tools</button>
        <MarkdownProvider readImage={(path, signal) => readLocalImage(api, "C:/project", path, signal)}>
          <CurrentSessionProviders document={storyDocument(tools())}>
            <Show when={state.visible}>
              <Show
                when={options.grouped}
                fallback={
                  <ToolDisplay
                    id="read_image"
                    tool="read"
                    input={{ path: options.path }}
                    metadata={{}}
                    status={status()}
                  />
                }
              >
                <CurrentContextToolGroup
                  parts={tools()}
                  busy={state.running}
                  open={state.open}
                  onOpenChange={(open) => setState("open", open)}
                />
              </Show>
            </Show>
          </CurrentSessionProviders>
        </MarkdownProvider>
      </section>
    )
  }, host)
}
