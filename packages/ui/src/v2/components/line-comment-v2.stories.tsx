// @ts-nocheck
import { createSignal } from "solid-js"
import {
  LineCommentEditorV2,
  LineCommentV2,
  LineCommentV2OverflowIcon,
} from "./line-comment-v2"

const docs = `### Overview
Line comment **display** and **editor** cards aligned with OpenCode line-comment specs (raised \`#FAFAFA\` surface, footer line context, \`ButtonV2\` neutral + contrast actions).

### Display
- \`LineCommentV2\`: column stack (body + meta) beside optional \`actions\` (overflow).
- Use \`LineCommentV2OverflowIcon\` inside a \`data-slot="line-comment-v2-overflow"\` button for the Figma dots control.

### Editor
- \`LineCommentEditorV2\`: optional \`heading\` above the textarea (default “Comment”), footer (selection meta + Cancel / Comment).
- \`Enter\` submits (Shift+Enter newline); \`Escape\` cancels. Controlled via \`value\` / \`onInput\`.
`

export default {
  title: "UI V2/LineComment",
  id: "components-line-comment-v2",
  component: LineCommentV2,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Display = {
  render: () => (
    <div style={{ width: "400px" }}>
      <LineCommentV2
        comment="Consider guarding against empty arrays."
        selection="Comment on line 40"
        actions={
          <button type="button" data-slot="line-comment-v2-overflow" aria-label="Comment actions">
            <LineCommentV2OverflowIcon />
          </button>
        }
      />
    </div>
  ),
}

export const DisplayWithoutActions = {
  render: () => (
    <div style={{ width: "400px" }}>
      <LineCommentV2 comment="Consider guarding against empty arrays." selection="Comment on line 40" />
    </div>
  ),
}

export const Editor = {
  render: () => {
    const [value, setValue] = createSignal("")
    return (
      <div style={{ width: "400px" }}>
        <LineCommentEditorV2
          value={value()}
          onInput={setValue}
          onCancel={() => setValue("")}
          onSubmit={() => setValue("")}
          selection="Comment on line 40"
        />
      </div>
    )
  },
}

export const EditorFilled = {
  render: () => {
    const [value, setValue] = createSignal("Use a sentinel or early return when the list is empty.")
    return (
      <div style={{ width: "400px" }}>
        <LineCommentEditorV2
          value={value()}
          onInput={setValue}
          onCancel={() => setValue("")}
          onSubmit={() => {}}
          selection="Comment on line 40"
          autofocus={false}
        />
      </div>
    )
  },
}
