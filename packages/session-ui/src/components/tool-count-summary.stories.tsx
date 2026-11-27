import { Button } from "@opencode/ui/button"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { AnimatedCountList, type CountItem } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"

const text = {
  active: "Exploring",
  done: "Explored",
} as const

type Counts = { reads: number; searches: number; lists: number; active: boolean }

function ContextProgress(props: Counts) {
  const [state, setState] = createStore({ ...props })

  for (const key of ["reads", "searches", "lists", "active"] as const) {
    createEffect(() => setState({ [key]: props[key] }))
  }

  const items = (): CountItem[] => [
    { key: "ui.messagePart.context.read", count: state.reads },
    { key: "ui.messagePart.context.search", count: state.searches },
    { key: "ui.messagePart.context.list", count: state.lists },
  ]

  const reset = () => setState({ ...props })

  return (
    <div class="flex max-w-[620px] flex-col gap-5 rounded-lg border border-border-weak-base bg-background-base p-5">
      <span class="flex min-w-0 items-center gap-2 text-14-medium text-text-strong">
        <span class="shrink-0">
          <ToolStatusTitle active={state.active} activeText={text.active} doneText={text.done} split={false} />
        </span>
        <span class="min-w-0 truncate text-14-regular text-text-base">
          <AnimatedCountList items={items()} fallback="" />
        </span>
      </span>
      <div class="flex flex-wrap gap-2">
        <Button size="small" variant="neutral" onClick={() => setState("reads", (value) => value + 1)}>
          Read file
        </Button>
        <Button size="small" variant="neutral" onClick={() => setState("searches", (value) => value + 1)}>
          Search code
        </Button>
        <Button size="small" variant="neutral" onClick={() => setState("lists", (value) => value + 1)}>
          List directory
        </Button>
        <Button size="small" variant="contrast" onClick={() => setState("active", false)}>
          Finish
        </Button>
        <Button size="small" variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  )
}

export default {
  title: "OpenCode/Work/Context progress",
  id: "components-animated-count-list",
  component: AnimatedCountList,
  argTypes: Object.fromEntries(
    ["reads", "searches", "lists"].map((key) => [key, { control: { type: "range", min: 0, max: 100, step: 1 } }]),
  ),
  parameters: {
    docs: {
      description: {
        component:
          "The production summary for grouped read, search, and list tools. The controls advance deterministic user actions without timers or random state.",
      },
    },
  },
}

export const Exploring = {
  args: { reads: 2, searches: 1, lists: 0, active: true },
  render: (args: Counts) => <ContextProgress {...args} />,
}

export const Completed = {
  args: { reads: 5, searches: 3, lists: 1, active: false },
  render: (args: Counts) => (
    <span class="flex items-center gap-2 text-14-medium text-text-strong">
      <ToolStatusTitle active={args.active} activeText={text.active} doneText={text.done} split={false} />
      <span class="text-14-regular text-text-base">
        <AnimatedCountList
          items={[
            { key: "ui.messagePart.context.read", count: args.reads },
            { key: "ui.messagePart.context.search", count: args.searches },
            { key: "ui.messagePart.context.list", count: args.lists },
          ]}
          fallback=""
        />
      </span>
    </span>
  ),
}
