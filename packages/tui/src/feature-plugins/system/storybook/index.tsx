import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createResource, createSignal, For, Suspense, type JSX } from "solid-js"
import { StoryFooter } from "./footer"

/**
 * A story is a full-screen, fixture-driven simulation of a real production component. Stories own
 * their entire screen (including any footer) and should bind escape back to the storybook index.
 */
export type Story = {
  id: string
  title: string
  render: (context: Plugin.Context) => JSX.Element
}

type StoryDef = {
  id: string
  title: string
  load: () => Promise<Story>
}

// Light index: each story loads via await import() only when opened.
const storyDefs: StoryDef[] = [
  { id: "merman-layouts", title: "Merman layouts", load: () => import("./merman-layouts").then((mod) => mod.mermanLayoutsStory) },
  { id: "session-tabs", title: "Tabs", load: () => import("./session-tabs").then((mod) => mod.sessionTabsStory) },
  {
    id: "session-location-missing",
    title: "Location missing",
    load: () => import("./session-location-missing").then((mod) => mod.sessionLocationMissingStory),
  },
  { id: "one-cell-spinner", title: "Spinner", load: () => import("./one-cell-spinner").then((mod) => mod.oneCellSpinnerStory) },
  { id: "link-clicks", title: "Links", load: () => import("./link-clicks").then((mod) => mod.linkClicksStory) },
  { id: "highlights", title: "Highlights", load: () => import("./highlights").then((mod) => mod.highlightsStory) },
  { id: "todo", title: "Todo", load: () => import("./todo").then((mod) => mod.todoStory) },
]

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
      ...storyDefs.map((story) => ({
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

function StoryView(props: { context: Plugin.Context; storyID: string }) {
  const [story] = createResource(props.storyID, async (id) => {
    const def = storyDefs.find((item) => item.id === id)
    if (!def) return undefined
    return def.load()
  })
  return (
    <Suspense fallback={<StorybookIndex context={props.context} />}>
      {story()?.render(props.context)}
    </Suspense>
  )
}

function StorybookIndex(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [selected, setSelected] = createSignal(0)
  const open = (story: StoryDef) =>
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
        run: () => setSelected((current) => (current + storyDefs.length - 1) % storyDefs.length),
      },
      {
        bind: "down,j",
        title: "Next story",
        group: "Storybook",
        run: () => setSelected((current) => (current + 1) % storyDefs.length),
      },
      {
        bind: "return",
        title: "Open story",
        group: "Storybook",
        run: () => {
          const story = storyDefs[selected()]
          if (story) open(story)
        },
      },
      ...storyDefs.map((story, index) => ({
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
      backgroundColor={theme.background.base}
    >
      <box paddingTop={2} paddingLeft={2} flexDirection="column">
        <text fg={theme.text.base}>storybook</text>
        <text fg={theme.text.muted}>fixture-driven simulations of production components</text>
        <box height={1} />
        <For each={storyDefs}>
          {(story, index) => (
            <text fg={index() === selected() ? theme.text.base : theme.text.muted}>
              {index() === selected() ? "› " : "  "}
              {index() + 1} {story.title}
            </text>
          )}
        </For>
      </box>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="storybook"
        controls={[
          { shortcut: "↑/↓", label: "select" },
          { shortcut: "enter", label: "open" },
          { shortcut: "esc", label: "home" },
        ]}
      />
    </box>
  )
}

export default Plugin.define({
  id: "opencode.storybook",
  setup(context) {
    context.ui.router.register({
      name: "storybook",
      render: (input) => {
        const storyID = input.data?.story as string | undefined
        if (storyID) return <StoryView context={context} storyID={storyID} />
        return <StorybookIndex context={context} />
      },
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
