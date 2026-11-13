import { Button } from "@opencode/ui/button"
import { createSignal, For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { browserPaneFixture, type BrowserScenario } from "./panel.fixture"
import barStyles from "./bar.css?inline"
import commentStyles from "./comment.css?inline"

function BrowserStory(props: { scenario: BrowserScenario }) {
  const language = usePlugin()

  return (
    <Show when={props.scenario} keyed>
      {(scenario) => {
        const Fixture = browserPaneFixture({
          scenario,
          useLanguage: () => language,
          Page: (page) => {
            const [saved, setSaved] = createSignal(false)
            let surface!: HTMLDivElement

            return (
              <div ref={surface} class="absolute inset-0 overflow-auto px-6 py-10">
                <article class="mx-auto flex max-w-md flex-col items-start gap-4" style={{ zoom: page.zoom }}>
                  <p class="text-12-regular text-v2-text-text-muted break-all" dir="ltr">
                    {page.url}
                  </p>
                  <h2 class="font-medium text-v2-text-text-strong">Project preview</h2>
                  <p class="text-13-regular text-v2-text-text-base">
                    {page.picking
                      ? "Select Save changes to annotate this element."
                      : "Save the sample page or add a note to the session."}
                  </p>
                  <Button
                    variant="outline"
                    onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
                      if (!page.picking) return setSaved(true)
                      const box = event.currentTarget.getBoundingClientRect()
                      const origin = surface.getBoundingClientRect()
                      page.pick({ x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height })
                    }}
                  >
                    Save changes
                  </Button>
                  <Show when={saved()}>
                    <p role="status">Changes saved to fixture.</p>
                  </Show>
                </article>
              </div>
            )
          },
          Frame: (frame) => (
            <section class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3">
              {/* The in-app web host only installs browser styles on desktop. */}
              <style>{barStyles + commentStyles}</style>
              <div class="h-[400px] min-w-0 overflow-hidden rounded-lg border border-v2-border-border-muted">
                {frame.children}
              </div>
              <div class="flex flex-wrap items-center gap-3 text-12-regular text-v2-text-text-muted">
                <span>Fixture page · Addresses and actions stay in this preview.</span>
                <Show when={frame.loading}>
                  <Button size="small" onClick={frame.finish}>
                    Finish loading
                  </Button>
                </Show>
                <Show when={frame.suspended}>
                  <Button size="small" onClick={frame.reconnect}>
                    Reconnect
                  </Button>
                </Show>
              </div>
              <Show when={frame.external}>
                <output class="text-12-regular break-all">System browser request: {frame.external}</output>
              </Show>
              <For each={frame.comments}>
                {(note) => (
                  <p class="text-12-regular">
                    Attached: {note.label} {note.comment}
                  </p>
                )}
              </For>
            </section>
          ),
        })

        return <Fixture />
      }}
    </Show>
  )
}

export default {
  title: "App/Plugins/Browser",
  id: "plugins-browser",
  args: { scenario: "Page" },
  argTypes: {
    scenario: {
      control: "select",
      options: ["Page", "Empty", "Recent", "Loading", "Failed", "Suspended"] satisfies BrowserScenario[],
    },
  },
  render: (props: { scenario: BrowserScenario }) => <BrowserStory {...props} />,
}

export const Page = { args: { scenario: "Page" } }

export const Empty = { args: { scenario: "Empty" } }

export const RecentPages = { args: { scenario: "Recent" } }

export const Loading = { args: { scenario: "Loading" } }

export const LoadFailed = { args: { scenario: "Failed" } }

export const Suspended = { args: { scenario: "Suspended" } }
