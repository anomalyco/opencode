import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { onMount } from "solid-js"
import { DialogHighlights } from "../../../component/dialog-highlights"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

// The v2.2.1 to v2.2.5 release highlights, as a release build embeds them from CHANGELOG.md.
const releases = [
  {
    version: "2.2.5",
    items: [
      {
        title: "Worktree and Shell Mode Shortcuts",
        body: "Press `⌘⌥O` on macOS or `Ctrl+Alt+O` on Windows and Linux to choose a worktree, and `⌘⌥B` or `Ctrl+Alt+B` to choose its base branch. `⌘⇧X` or `Ctrl+Shift+X` now toggles shell mode in the composer.",
      },
      {
        title: "Send Quotes From the Comment Popup",
        body: "Hold `⌘` or `Ctrl` in the quote popup to turn its checkmark into send, or press `⌘Enter` or `Ctrl+Enter`, to send just that quote and comment while leaving the rest of the composer untouched.",
      },
      {
        title: "Percentage Compaction Buffer",
        body: "Set `\"compaction\": { \"buffer\": \"20%\" }` in `opencode.json` to keep a share of each model's context window free, so one setting fits models with small and large windows. Token counts still work.",
      },
    ],
  },
  {
    version: "2.2.4",
    items: [
      {
        title: "Persistent Desktop Terminals",
        body: "Desktop terminals now belong to the session, survive server restarts with their scrollback, and stay synchronized with the TUI and other windows. Renamed terminals also keep their names across restarts.",
      },
      {
        title: "Publish Interactive Artifacts",
        body: "Enable `\"experimental\": { \"artifacts\": true }` in `opencode.json` to let agents publish, update, and serve HTML or static artifacts through the built-in local provider or plugin-provided storage.",
      },
      {
        title: "Guided Claude Agent Setup",
        body: "Select Claude Agent from the provider picker to copy `claude auth login`, install Claude Code, and verify the connection before continuing to model selection.",
      },
      {
        title: "Choose a Base Branch Quickly",
        body: "While creating a worktree, open Choose base branch with `⌘⌥.` on macOS or `Ctrl+Alt+.` on Windows and Linux. The command is also available in the command palette and Settings › Shortcuts.",
      },
    ],
  },
  {
    version: "2.2.3",
    items: [
      {
        title: "Use Claude Code in OpenCode",
        body: "Install Claude Code, run `claude auth login`, then select Claude Agent in `/connect` to use your Claude Code login and models.",
      },
      {
        title: "Faster Long Sessions in Desktop",
        body: "Streaming replies and long conversations now do much less rendering work.",
      },
      {
        title: "Desktop Stability Fixes",
        body: "Fixes side-panel tabs, repeated \"Session not found\" toasts, and Open file over HTTP.",
      },
    ],
  },
  {
    version: "2.2.2",
    items: [
      {
        title: "Image Generation by Default",
        body: "When a connected provider supports image models, agents can now use `experimental_image_generate` without additional configuration. Set its preferred model through `experimental.image_generate.model`.",
      },
      {
        title: "Faster Worktree Selection",
        body: "On the new-session screen, click the current Git branch to open that project’s “Run session in” worktree picker directly.",
      },
      {
        title: "Unified Quotes and Annotations",
        body: "Timeline quotes, terminal quotes, and browser annotations now share a compact optional-comment editor, while source highlights remain attached to local drafts.",
      },
    ],
  },
  {
    version: "2.2.1",
    items: [
      {
        title: "Keep Working Toward a Goal",
        body: "Run `/goal <objective>` in the TUI or Desktop to let the session continue until a reviewer confirms the objective is met. Use `/goal pause`, `/goal resume`, or `/goal clear` to control it.",
      },
      {
        title: "Generate Images",
        body: "Enable `experimental.image_generate` to let agents create or edit images with the new `image_generate` tool. You can optionally set its default model with `experimental.image_generate.model`.",
      },
      {
        title: "Inspect Background Shells",
        body: "Click a running shell in the Desktop activity pill to see its live output and stop it without leaving the menu.",
      },
      {
        title: "New Default Model Picker",
        body: "Search favorites, recent models, providers, and variants from the redesigned model picker, which is now the default in Desktop.",
      },
    ],
  },
]

function HighlightsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const open = (count: number) =>
    props.context.ui.dialog.show(() => <DialogHighlights releases={releases.slice(0, count)} />)

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "o", title: "Open five releases", group: "Storybook", run: () => open(5) },
      { bind: "t", title: "Open one release", group: "Storybook", run: () => open(1) },
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
          { shortcut: "o", label: "five releases" },
          { shortcut: "t", label: "one release" },
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
