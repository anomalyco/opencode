import { Button } from "@opencode/ui/button"
import { createSignal, For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { browserPaneFixture, type BrowserScenario } from "./panel.fixture"
import barStyles from "./bar.css?inline"
import commentStyles from "./comment.css?inline"

type Delivery = "Send" | "Steer" | "Queue" | "Unavailable"

type BrowserArgs = { scenario: BrowserScenario; delivery: Delivery }

function composerDelivery(value: Delivery) {
  if (value === "Send") return "send"

  if (value === "Steer") return "steer"

  if (value === "Queue") return "queue"
}

function BrowserLab(props: BrowserArgs) {
  const language = usePlugin()

  return (
    <Show when={`${props.scenario}:${props.delivery}`} keyed>
      {() => {
        const Fixture = browserPaneFixture({
          scenario: props.scenario,
          delivery: composerDelivery(props.delivery),
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
                    {frame.sent.includes(note.commentID) ? "Sent" : "Attached"}: {note.label} {note.comment}
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
  args: { scenario: "Page", delivery: "Steer" },
  argTypes: {
    delivery: { control: "select", options: ["Send", "Steer", "Queue", "Unavailable"] satisfies Delivery[] },
    scenario: {
      control: "select",
      options: ["Page", "Empty", "Recent", "History", "Loading", "Failed", "Suspended"] satisfies BrowserScenario[],
    },
  },
  render: (props: BrowserArgs) => <BrowserLab {...props} />,
}

export const Page = { args: { scenario: "Page" } }

export const Empty = { args: { scenario: "Empty" } }

export const RecentPages = { args: { scenario: "Recent" } }

// A history as an import from another browser leaves it: type in the address field, for example "rune" or "gith".
export const ImportedHistory = { args: { scenario: "History" } }

export const Loading = { args: { scenario: "Loading" } }

export const LoadFailed = { args: { scenario: "Failed" } }

export const Suspended = { args: { scenario: "Suspended" } }

// Comments: press Comment on part of the page in the bar, pick Save changes, type, then hover the check button. Enter
// attaches the comment; Mod+Enter attaches and sends it, labelled by how the session takes it now. "Add page to
// session" under Browser options opens the page note editor, with the same two actions.

/** The session is idle: Mod+Enter reads "Send comment". */
export const CommentSend = { args: { scenario: "Page", delivery: "Send" } }

/** The session works and the follow-up behavior steers: "Steer comment". */
export const CommentSteer = { args: { scenario: "Page", delivery: "Steer" } }

/** The session works and the follow-up behavior queues: "Queue comment". */
export const CommentQueue = { args: { scenario: "Page", delivery: "Queue" } }

/** Nothing can be sent now, e.g. in a subagent's session or while another send is in flight: the action is disabled. */
export const CommentSendUnavailable = { args: { scenario: "Page", delivery: "Unavailable" } }
