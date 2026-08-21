import { Button } from "@opencode-ai/ui/button"
import { createStore } from "solid-js/store"
import { AnimatedCountList, type CountItem } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"

const text = {
  active: "Exploring",
  done: "Explored",
} as const

function ContextProgress() {
  const [state, setState] = createStore({ reads: 2, searches: 1, lists: 0, active: true })
  const items = (): CountItem[] => [
    { key: "ui.messagePart.context.read", count: state.reads },
    { key: "ui.messagePart.context.search", count: state.searches },
    { key: "ui.messagePart.context.list", count: state.lists },
  ]
  const reset = () => setState({ reads: 2, searches: 1, lists: 0, active: true })
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
  render: () => <ContextProgress />,
}

export const Completed = {
  render: () => (
    <span class="flex items-center gap-2 text-14-medium text-text-strong">
      <ToolStatusTitle active={false} activeText={text.active} doneText={text.done} split={false} />
      <span class="text-14-regular text-text-base">
        <AnimatedCountList
          items={[
            { key: "ui.messagePart.context.read", count: 5 },
            { key: "ui.messagePart.context.search", count: 3 },
            { key: "ui.messagePart.context.list", count: 1 },
          ]}
          fallback=""
        />
      </span>
    </span>
  ),
}
