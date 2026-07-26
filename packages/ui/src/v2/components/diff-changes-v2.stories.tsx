import { DiffChanges } from "./diff-changes-v2"

const docs = `### Overview  
Summarize additions/deletions as compact text.

Pair with \`Diff\`/\`DiffSSR\` to contextualize a change set.

### API
- Required: \`changes\` as { additions, deletions } or an array of those objects.

### Variants and states
- Handles zero-change state (renders nothing).

### Behavior
- Aggregates arrays into total additions/deletions.

### Accessibility
- Ensure surrounding context conveys meaning of the counts/bars.

### Theming/tokens
- Uses \`data-component="diff-changes"\` and diff color tokens.

`

const changes = { additions: 12, deletions: 5 }

export default {
  title: "UI V2/DiffChanges",
  id: "components-diff-changes-v2",
  component: DiffChanges,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    changes,
  },
}

export const Default = {}

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
