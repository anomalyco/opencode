import { DiffChanges } from "./diff-changes"

const docs = `### Overview  
Summarize additions/deletions as compact text.

Pair with \`Diff\`/\`DiffSSR\` to contextualize a change set.

### API
- Required: \`changes\` as { additions, deletions } or an array of those objects.
- Optional: \`appearance\` is \`compact\` (default) or \`standard\`.

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
  title: "UI/DiffChanges",
  id: "ui-diff-changes",
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

export const Appearances = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <DiffChanges appearance="standard" changes={changes} />
      <DiffChanges appearance="compact" changes={changes} />
    </div>
  ),
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
