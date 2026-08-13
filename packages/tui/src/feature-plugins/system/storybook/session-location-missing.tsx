import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal, For, Show } from "solid-js"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const missing = "~/code/open-source/opencode-workerd-profile"
const destinations = ["~/code/open-source/opencode", "~/code/open-source/opencode-instruction-rename"]

function SessionLocationMissingStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.elevated
  const [state, setState] = createSignal<"missing" | "move" | "recovered">("missing")
  const [selected, setSelected] = createSignal(0)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "return",
        title: "Continue",
        group: "Storybook",
        run: () => {
          if (state() === "missing") return setState("move")
          if (state() === "move") return setState("recovered")
        },
      },
      {
        bind: "up,k",
        title: "Previous destination",
        group: "Storybook",
        run: () => state() === "move" && setSelected((current) => (current + destinations.length - 1) % destinations.length),
      },
      {
        bind: "down,j",
        title: "Next destination",
        group: "Storybook",
        run: () => state() === "move" && setSelected((current) => (current + 1) % destinations.length),
      },
      {
        bind: "r",
        title: "Reset story",
        group: "Storybook",
        run: () => {
          setSelected(0)
          setState("missing")
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.default}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexGrow={1}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>Workerd Modal workspace driver</text>
        <text fg={theme.text.subdued}>build · GPT-5.6 Sol (high)</text>
        <box height={1} />
        <text fg={theme.text.default}>You</text>
        <text fg={theme.text.subdued}>Test the mounted workspace and verify the deployment.</text>
        <box height={1} />
        <text fg={theme.text.default}>Build · GPT-5.6 Sol (high)</text>
        <text fg={theme.text.subdued}>The deployment is verified and the worktree is clean.</text>
        <box flexGrow={1} />
        <Show when={state() === "missing"}>
          <box border={["left"]} borderColor={theme.text.feedback.warning.default} paddingLeft={2} gap={1}>
            <text fg={theme.text.feedback.warning.default} attributes={TextAttributes.BOLD}>
              Session directory no longer exists
            </text>
            <text fg={theme.text.subdued}>{missing}</text>
            <text fg={theme.text.default}>Move this session to continue.</text>
            <text fg={theme.text.action.primary.default}>[ Move session ]  <span style={{ fg: theme.text.subdued }}>[ Copy path ]</span></text>
          </box>
        </Show>
        <Show when={state() === "move"}>
          <box border={["left"]} borderColor={theme.border.default} paddingLeft={2} gap={1}>
            <text fg={theme.text.default} attributes={TextAttributes.BOLD}>Move session</text>
            <text fg={theme.text.subdued}>Choose a project directory</text>
            <For each={destinations}>
              {(directory, index) => (
                <text fg={index() === selected() ? theme.text.action.primary.focused : theme.text.subdued}>
                  {index() === selected() ? "› " : "  "}{directory}
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show when={state() === "recovered"}>
          <box border={["left"]} borderColor={theme.text.feedback.success.default} paddingLeft={2} gap={1}>
            <text fg={theme.text.feedback.success.default} attributes={TextAttributes.BOLD}>Session moved</text>
            <text fg={theme.text.subdued}>{destinations[selected()]}</text>
            <box border borderStyle="rounded" borderColor={theme.border.default} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.subdued}>Ask anything...</text>
            </box>
          </box>
        </Show>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / missing session directory"
        details={[state()]}
        controls={[
          { shortcut: "enter", label: state() === "move" ? "move" : "continue" },
          { shortcut: "↑/↓", label: "destination" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const sessionLocationMissingStory: Story = {
  id: "session-location-missing",
  title: "Missing session directory",
  render: (context) => <SessionLocationMissingStory context={context} />,
}
