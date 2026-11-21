import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { cached, WidgetBackendProvider, type WidgetBackend, type WidgetInfo } from "../../../component/widget/backend"
import { createWidgetFocus, WidgetMessage } from "../../../component/widget/message"
import { StoryFooter } from "./footer"
import type { Story } from "./index"
import { widgetFixtureMessage, widgetFixtures, type WidgetFixtureName } from "./widget.fixtures"

const widgetTemplates = Object.keys(widgetFixtures) as WidgetFixtureName[]
const statuses: WidgetInfo["status"][] = ["open", "submitted", "dismissed"]

function WidgetStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [widgetTemplate, setWidgetTemplate] = createSignal<WidgetFixtureName>("suggestions")
  const [narrow, setNarrow] = createSignal(false)
  const [run, setRun] = createSignal(0)
  const [message, setMessage] = createSignal(widgetFixtureMessage("suggestions"))
  const [last, setLast] = createSignal<string>()
  const focus = createWidgetFocus(() => [message()])
  const width = () => (narrow() ? Math.min(48, dimensions().width) : dimensions().width)

  const show = (name: WidgetFixtureName, status: WidgetInfo["status"]) => {
    setWidgetTemplate(name)
    setRun((value) => value + 1)
    setMessage(widgetFixtureMessage(name, status, `msg_widget_${name}_${run()}`))
  }

  // Responses stay in the story: they flip the fixture message the way the widgets plugin's changed event would.
  const backend: WidgetBackend = {
    program: (input) =>
      cached(input, () => Promise.reject(new Error(`${input.name} is not a built-in widget template`))),
    async respond(input) {
      const response = input.response
      setLast("dismiss" in response ? "dismissed" : JSON.stringify(response.value))
      setMessage((current) => ({
        ...current,
        status: "dismiss" in response ? "dismissed" : "submitted",
        ...("value" in response ? { response: response.value } : {}),
      }))
    },
    async report(input) {
      setLast(`error ${input.error.phase}: ${input.error.message}`)
    },
    async send(input) {
      setLast(`sent ${JSON.stringify(input.value)}${input.wake ? "" : " (no wake)"}`)
    },
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "t",
        title: "Next widget template",
        group: "Storybook",
        run: () =>
          show(
            widgetTemplates[(widgetTemplates.indexOf(widgetTemplate()) + 1) % widgetTemplates.length],
            message().status,
          ),
      },
      {
        bind: "s",
        title: "Next status",
        group: "Storybook",
        run: () => show(widgetTemplate(), statuses[(statuses.indexOf(message().status) + 1) % statuses.length]),
      },
      { bind: "w", title: "Toggle narrow width", group: "Storybook", run: () => setNarrow((value) => !value) },
      { bind: "i", title: "Focus widget", group: "Storybook", run: () => focus.engage(message().id) },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () => {
          setLast(undefined)
          show(widgetTemplate(), "open")
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <scrollbox flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
        <box width={width() - 4}>
          <WidgetBackendProvider backend={backend}>
            <Show when={message().id} keyed>
              {(_) => <WidgetMessage message={message()} focus={focus} />}
            </Show>
          </WidgetBackendProvider>
        </box>
      </scrollbox>
      <StoryFooter
        context={props.context}
        title="storybook / widget"
        details={[widgetTemplate(), message().status, narrow() ? "narrow" : "wide"]}
        status={focus.engaged() ? "widget has the keyboard" : "story keys active"}
        message={last() ? `last response: ${last()}` : "responses stay local to the story"}
        controls={[
          { shortcut: "t", label: "widgetTemplate" },
          { shortcut: "s", label: "status" },
          { shortcut: "w", label: "width" },
          { shortcut: "i", label: "focus widget" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "release / back" },
        ]}
      />
    </box>
  )
}

export const widgetStory: Story = {
  id: "widget",
  title: "Agent widgets",
  render: (context) => <WidgetStory context={context} />,
}
