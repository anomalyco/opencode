import type { ComponentProps } from "solid-js"
import { DiffChanges } from "./diff-changes"

type Args = Pick<ComponentProps<typeof DiffChanges>, "appearance" | "markEmpty"> & {
  additions: number
  deletions: number
  multipleFiles: boolean
}

const count = { control: { type: "range", min: 0, max: 100, step: 1 } }

const docs = `### Overview
Summarize additions/deletions as compact text. Pair with Diff or DiffSSR to contextualize a change set.

### API and behavior
Changes accepts one { additions, deletions } object or an array. Adjust the first file’s counts; Multiple files adds two more changes (+8/−3 and +2/−0).
The component aggregates totals and renders nothing for zero changes. Marking empty sides lets the caller hide them.

### Appearance and accessibility
Choose compact or standard. Provide surrounding context for the counts. The component uses data-component="diff-changes" and diff color tokens.`

function Preview(args: Args) {
  const file = () => ({ additions: args.additions, deletions: args.deletions })

  return (
    <DiffChanges
      class="[&_[data-empty]]:hidden"
      appearance={args.appearance}
      markEmpty={args.markEmpty}
      changes={args.multipleFiles ? [file(), { additions: 8, deletions: 3 }, { additions: 2, deletions: 0 }] : file()}
    />
  )
}

export default {
  title: "UI/DiffChanges",
  id: "ui-diff-changes",
  component: DiffChanges,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
  args: { additions: 12, deletions: 5, appearance: "compact", markEmpty: false, multipleFiles: false } satisfies Args,
  argTypes: {
    additions: count,
    deletions: count,
    appearance: { control: "select", options: ["compact", "standard"] },
  },
  render: Preview,
}

export const Default = {}

export const Appearances = {
  render: (args: Args) => (
    <div class="flex items-center gap-4">
      <Preview {...args} appearance="standard" />
      <Preview {...args} appearance="compact" />
    </div>
  ),
}

export const MultipleFiles = { args: { multipleFiles: true, additions: 4, deletions: 1 } }

export const Zero = { args: { additions: 0, deletions: 0 } }
