import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { onMount } from "solid-js"
import { DialogHighlights } from "../../../component/dialog-highlights"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

// The v2.0.27 release highlights, as a release build embeds them.
const items = [
  {
    title: "Built-In Worktree Tools",
    body: "Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create isolated worktrees, move sessions into them, and remove them with normal edit approval.",
  },
  {
    title: "Safer Remote Pairing",
    body: "The first `opencode pair --remote` now warns that it will expose your server and asks for confirmation. For non-interactive use, pass `opencode pair --remote --yes`.",
  },
  {
    title: "Installable Web App",
    body: "Use Chrome or Edge’s Install button to install the OpenCode web app, including when it runs behind an authenticating proxy.",
  },
  {
    title: "Clear Session Failures",
    body: "Desktop and TUI timelines now show execution errors that happen before or between model steps instead of ending without an explanation.",
  },
  {
    title: "Automatic Project Cleanup",
    body: "Projects whose directories no longer exist are automatically hidden from the project list. Opening the directory again restores the project.",
  },
]

function HighlightsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const open = (count: number) =>
    props.context.ui.dialog.show(() => <DialogHighlights version="2.0.27" items={items.slice(0, count)} />)

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "o", title: "Open five highlights", group: "Storybook", run: () => open(5) },
      { bind: "t", title: "Open two highlights", group: "Storybook", run: () => open(2) },
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
    ],
  }))
  onMount(() => open(5))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={props.context.theme.background.base}>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="storybook / release highlights"
        controls={[
          { shortcut: "o", label: "five highlights" },
          { shortcut: "t", label: "two highlights" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const highlightsStory: Story = {
  id: "highlights",
  title: "Release highlights",
  render: (context) => <HighlightsStory context={context} />,
}
