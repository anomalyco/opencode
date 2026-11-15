import type { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageInfo } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For } from "solid-js"
import { SidebarTodo } from "../../sidebar/todo"
import type { TodoStatus } from "../../../util/todo"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const statuses: TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"]

const initial = [
  { content: "Read the existing sidebar plugins", status: "completed" as TodoStatus },
  { content: "Derive the current list from the latest todowrite call", status: "in_progress" as TodoStatus },
  { content: "Render the todowrite tool part like V1", status: "pending" as TodoStatus },
  { content: "Add a database table for todos", status: "cancelled" as TodoStatus },
]

function TodoStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [todos, setTodos] = createSignal(initial)
  const [selected, setSelected] = createSignal(0)
  const messages = createMemo((): SessionMessageInfo[] => [
    {
      id: "fixture-message",
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      time: { created: 0, completed: 1 },
      content: [
        {
          type: "tool",
          id: "fixture-todowrite",
          name: "todowrite",
          time: { created: 0, completed: 1 },
          state: {
            status: "completed",
            input: { todos: todos() },
            content: [{ type: "text", text: "updated" }],
          },
        },
      ],
    },
  ])
  const fixture: Plugin.Context = {
    ...props.context,
    data: {
      ...props.context.data,
      session: {
        ...props.context.data.session,
        get: () => undefined,
        message: { ...props.context.data.session.message, list: () => messages() },
      },
    },
  }
  const cycle = () =>
    setTodos((list) =>
      list.map((todo, index) =>
        index === selected()
          ? { ...todo, status: statuses[(statuses.indexOf(todo.status) + 1) % statuses.length] }
          : todo,
      ),
    )

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "up,k",
        title: "Previous todo",
        group: "Storybook",
        run: () => setSelected((index) => Math.max(0, index - 1)),
      },
      {
        bind: "down,j",
        title: "Next todo",
        group: "Storybook",
        run: () => setSelected((index) => Math.min(todos().length - 1, index + 1)),
      },
      { bind: "s", title: "Cycle status", group: "Storybook", run: cycle },
      {
        bind: "a",
        title: "Add todo",
        group: "Storybook",
        run: () =>
          setTodos((list) => [
            ...list,
            { content: `Follow-up task ${list.length + 1} with a longer description that wraps`, status: "pending" },
          ]),
      },
      {
        bind: "c",
        title: "Complete all",
        group: "Storybook",
        run: () => setTodos((list) => list.map((todo) => ({ ...todo, status: "completed" as TodoStatus }))),
      },
      {
        bind: "x",
        title: "Clear todos",
        group: "Storybook",
        run: () => {
          setTodos([])
          setSelected(0)
        },
      },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () => {
          setTodos(initial)
          setSelected(0)
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexDirection="row" flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={4}>
        <box flexGrow={1} flexDirection="column">
          <text fg={theme.text.base}>Fixture todowrite input</text>
          <box height={1} />
          <For each={todos()}>
            {(todo, index) => (
              <text fg={index() === selected() ? theme.text.formfield.selected : theme.text.muted}>
                {index() === selected() ? "› " : "  "}
                {todo.status.padEnd(11)} {todo.content}
              </text>
            )}
          </For>
        </box>
        <box width={38} flexShrink={0} backgroundColor={theme.background.raised.base} padding={1}>
          <SidebarTodo context={fixture} sessionID="fixture-session" />
        </box>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / todo sidebar"
        details={[`${todos().length} todos`]}
        message="Hidden when there are no pending or in-progress todos"
        controls={[
          { shortcut: "↑↓", label: "select" },
          { shortcut: "s", label: "cycle status" },
          { shortcut: "a", label: "add" },
          { shortcut: "c", label: "complete all" },
          { shortcut: "x", label: "clear" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const todoStory: Story = {
  id: "todo",
  title: "Todo sidebar",
  render: (context) => <TodoStory context={context} />,
}
