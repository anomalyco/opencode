// @ts-nocheck
import * as mod from "./code"
import { create } from "../storybook/scaffold"
import { code } from "../storybook/fixtures"

const docs = `### Overview
Syntax-highlighted code viewer with selection support and large-file virtualization.

Use alongside \`LineComment\` and \`Diff\` in review workflows.

### API
- Required: \`file\` with file name + contents.
- Optional: \`language\`, \`annotations\`, \`selectedLines\`, \`commentedLines\`.
- Optional callbacks: \`onRendered\`, \`onLineSelectionEnd\`.

### Variants and states
- Supports large-file virtualization automatically.

### Behavior
- Re-renders when \`file\` or rendering options change.
- Optional line selection integrates with selection callbacks.

### Accessibility
- TODO: confirm keyboard find and selection behavior.

### Theming/tokens
- Uses \`data-component="code"\` and Pierre CSS variables from \`styleVariables\`.

`

const story = create({
  title: "UI/Code",
  mod,
  args: {
    file: code,
    language: "ts",
  },
})

export default {
  title: "UI/Code",
  id: "components-code",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const SelectedLines = {
  args: {
    enableLineSelection: true,
    selectedLines: { start: 2, end: 4 },
  },
}

export const CommentedLines = {
  args: {
    commentedLines: [
      { start: 1, end: 1 },
      { start: 5, end: 6 },
    ],
  },
}
