// @ts-nocheck
import * as mod from "./diff-changes"
import { create } from "../storybook/scaffold"
import { changes } from "../storybook/fixtures"

const docs = `### Overview
Summarize additions/deletions as text or compact bars.

Pair with \`Diff\`/\`DiffSSR\` to contextualize a change set.

### API
- Required: \`changes\` as { additions, deletions } or an array of those objects.
- Optional: \`variant\` ("default" | "bars").

### Variants and states
- Default text summary or bar visualization.
- Handles zero-change state (renders nothing in default variant).

### Behavior
- Aggregates arrays into total additions/deletions.

### Accessibility
- Ensure surrounding context conveys meaning of the counts/bars.

### Theming/tokens
- Uses \`data-component="diff-changes"\` and diff color tokens.

`

const story = create({
  title: "UI/DiffChanges",
  mod,
  args: {
    changes,
    variant: "default",
  },
})

export default {
  title: "UI/DiffChanges",
  id: "components-diff-changes",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "bars"],
    },
  },
}

export const Default = story.Basic

export const Bars = {
  args: {
    variant: "bars",
  },
}

export const MultipleFiles = {
  args: {
    changes: [
      { additions: 4, deletions: 1 },
      { additions: 8, deletions: 3 },
      { additions: 2, deletions: 0 },
    ],
  },
}

export const Zero = {
  args: {
    changes: { additions: 0, deletions: 0 },
  },
}
