import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, type JSX } from "solid-js"
import { sessionTabsStory } from "./session-tabs"

/**
 * A story is a full-screen, fixture-driven simulation of a real production component. Stories own
 * their entire screen (including any footer) and should bind escape back to the storybook index.
 */
export type Story = {
  id: string
  title: string
  render: (context: Plugin.Context) => JSX.Element
}

const stories: Story[] = [sessionTabsStory]

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "app.storybook",
        title: "Open storybook",
        group: "Debug",
        palette: true,
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "storybook" })
          props.context.ui.dialog.clear()
        },
      },
      ...stories.map((story) => ({
        id: `app.storybook.${story.id}`,
        title: `Storybook: ${story.title}`,
        group: "Debug",
        palette: true as const,
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "storybook", data: { story: story.id } })
          props.context.ui.dialog.clear()
        },
      })),
    ],
  }))
  return null
}

function StorybookIndex(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const elevatedTheme = theme.contextual.elevated
  const [selected, setSelected] = createSignal(0)
  const open = (story: Story) =>
    props.context.ui.router.navigate({ type: "plugin", name: "storybook", data: { story: story.id } })

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back home",
        group: "Storybook",
        run() {
          props.context.ui.router.navigate({ type: "home" })
        },
      },
      {
        bind: "up,k",
        title: "Previous story",
        group: "Storybook",
        run: () => setSelected((current) => (current + stories.length - 1) % stories.length),
      },
      {
        bind: "down,j",
        title: "Next story",
        group: "Storybook",
        run: () => setSelected((current) => (current + 1) % stories.length),
      },
      {
        bind: "return",
        title: "Open story",
        group: "Storybook",
        run: () => open(stories[selected()]),
      },
      ...stories.map((story, index) => ({
        bind: String(index + 1),
        title: `Open ${story.title}`,
        group: "Storybook",
        run: () => open(story),
      })),
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <box paddingTop={2} paddingLeft={2} flexDirection="column">
        <text fg={theme.text.default}>storybook</text>
        <text fg={theme.text.subdued}>fixture-driven simulations of production components</text>
        <box height={1} />
        <For each={stories}>
          {(story, index) => (
            <text fg={index() === selected() ? theme.text.default : theme.text.subdued}>
              {index() === selected() ? "› " : "  "}
              {index() + 1} {story.title}
            </text>
          )}
        </For>
      </box>
      <box flexGrow={1} />
      <box
        height={1}
        flexShrink={0}
        backgroundColor={elevatedTheme.background.default}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
      >
        <text fg={elevatedTheme.text.subdued}>storybook</text>
        <box flexGrow={1} />
        <text fg={elevatedTheme.text.subdued}>↑/↓ select | enter open | esc home</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.storybook",
  setup(context) {
    context.ui.router.register({
      name: "storybook",
      render: (input) => {
        const story = stories.find((story) => story.id === input.data?.story)
        if (story) return story.render(context)
        return <StorybookIndex context={context} />
      },
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
