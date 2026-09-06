// @ts-nocheck
import { createSignal } from "solid-js"
import { LineCommentEditor, LineComment, LineCommentOverflowIcon } from "./line-comment"
import { Menu } from "../../navigation/menu/menu"

const docs = `### Overview
Line comment **display** and **editor** cards aligned with OpenCode line-comment specs (raised \`#FAFAFA\` surface, footer line context, \`Button\` ghost + contrast actions).

### Display
- \`LineComment\`: column stack (body + meta) beside optional \`actions\` (overflow).
- Use \`LineCommentOverflowIcon\` inside a \`data-slot="line-comment-v2-overflow"\` button for the Figma dots control.

### Editor
- \`LineCommentEditor\`: optional \`heading\` above the textarea (default “Comment”), footer (selection meta + Cancel / Comment).
- \`Enter\` submits (Shift+Enter newline); \`Escape\` cancels. Controlled via \`value\` / \`onInput\`.
`

export default {
  title: "UI/LineComment",
  id: "ui-line-comment",
  component: LineComment,
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
      <LineComment
        comment="Consider guarding against empty arrays."
        selection="Comment on line 40"
        actions={
          <Menu gutter={4}>
            <Menu.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label="Comment actions">
              <LineCommentOverflowIcon />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item>Edit</Menu.Item>
                <Menu.Item>Delete</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        }
      />
    </div>
  ),
}

export const DisplayWithoutActions = {
  render: () => (
    <div style={{ width: "400px" }}>
      <LineComment comment="Consider guarding against empty arrays." selection="Comment on line 40" />
    </div>
  ),
}

export const Editor = {
  render: () => {
    const [value, setValue] = createSignal("")
    return (
      <div style={{ width: "400px" }}>
        <LineCommentEditor
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
        <LineCommentEditor
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
