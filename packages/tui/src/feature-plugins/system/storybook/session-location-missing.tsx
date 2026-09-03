import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"
import { DialogMoveSession } from "../../../component/dialog-move-session"
import { SessionLocationUnavailable } from "../../../routes/session/location-missing"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const directory = "/Users/kit/code/open-source/opencode-workerd-profile"

function SessionLocationMissingStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.elevated
  const [message, setMessage] = createSignal("Retry or choose another directory")
  const open = () =>
    props.context.ui.dialog.show(() => (
      <DialogMoveSession
        projectID="fixture-project"
        initialDirectories={[
          { directory: "/Users/kit/code/open-source/opencode" },
          {
            directory: "/Users/kit/code/open-source/opencode-instruction-rename",
            strategy: "git_worktree",
          },
        ]}
        fixture
        onSelect={(selection) => {
          if (selection.type !== "directory") return
          setMessage(`Selected ${selection.directory}`)
          props.context.ui.dialog.clear()
        }}
      />
    ))

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.default}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexGrow={1}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
          Workerd Modal workspace driver
        </text>
        <text fg={theme.text.subdued}>build · Demo Model</text>
        <box height={1} />
        <text fg={theme.text.default}>You</text>
        <text fg={theme.text.subdued}>Test the mounted workspace and verify the deployment.</text>
        <box height={1} />
        <text fg={theme.text.default}>Build · Demo Model</text>
        <text fg={theme.text.subdued}>The deployment is verified and the worktree is clean.</text>
        <box flexGrow={1} />
        <SessionLocationUnavailable
          directory={directory}
          message="Could not initialize this location"
          onRetry={() => setMessage("Retried location sync")}
          onMove={open}
        />
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / missing session directory"
        status={message()}
        controls={[
          { shortcut: "enter", label: "confirm" },
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
