// @ts-nocheck
import * as mod from "./diff"
import { create } from "../storybook/scaffold"
import { diff } from "../storybook/fixtures"

const docs = `### Overview
Render a code diff with OpenCode styling using the Pierre diff engine.

Pair with \`DiffChanges\` for summary counts.
Use \`LineComment\` or external UI for annotation workflows.

### API
- Required: \`before\` and \`after\` file contents (name + contents).
- Optional: \`diffStyle\` ("unified" | "split"), \`annotations\`, \`selectedLines\`, \`commentedLines\`.
- Optional interaction: \`enableLineSelection\`, \`onLineSelectionEnd\`.
- Passes through Pierre FileDiff options (see component source).

### Variants and states
- Unified and split diff styles.
- Optional line selection + commented line highlighting.

### Behavior
- Re-renders when \`before\`/\`after\` or diff options change.
- Line selection uses mouse drag/selection when enabled.

### Accessibility
- TODO: confirm keyboard behavior from the Pierre diff engine.
- Provide surrounding labels or headings when used as a standalone view.

### Theming/tokens
- Uses \`data-component="diff"\` and Pierre CSS variables from \`styleVariables\`.
- Colors derive from theme tokens (diff add/delete, background, text).

`

const story = create({
  title: "UI/Diff",
  mod,
  args: {
    before: diff.before,
    after: diff.after,
    diffStyle: "unified",
  },
})

export default {
  title: "UI/Diff",
  id: "components-diff",
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
    diffStyle: {
      control: "select",
      options: ["unified", "split"],
    },
    enableLineSelection: {
      control: "boolean",
    },
  },
}

export const Unified = story.Basic

export const Split = {
  args: {
    diffStyle: "split",
  },
}

export const Selectable = {
  args: {
    enableLineSelection: true,
  },
}

export const SelectedLines = {
  args: {
    selectedLines: { start: 2, end: 4 },
  },
}

export const CommentedLines = {
  args: {
    commentedLines: [
      { start: 1, end: 1 },
      { start: 4, end: 4 },
    ],
  },
}
