// @ts-nocheck
import { createSignal } from "solid-js"
import { LineCommentEditor, LineComment, LineCommentOverflowIcon } from "./line-comment"
import { Menu } from "../../navigation/menu/menu"

const docs = `### Overview
Line comment **display** and **editor** cards aligned with OpenCode line-comment specs (raised \`#FAFAFA\` surface, small \`Button\` ghost + contrast actions).

### Display
- \`LineComment\`: column stack (body + optional meta) beside optional \`actions\` (overflow). The body keeps its line breaks. \`onOpen\` makes a click anywhere on the card open it.
- Use \`LineCommentOverflowIcon\` inside a \`data-slot="line-comment-v2-overflow"\` button for the Figma dots control.

### Editor
- \`LineCommentEditor\`: the card is the text field (\`label\` names it, default “Comment”), footer (optional selection meta + Cancel / Comment).
- \`Enter\` submits (Shift+Enter newline); \`Escape\` cancels. Controlled via \`value\` / \`onInput\`.
- Compact editors show a cancel action when empty, unless \`allowEmpty\` enables submitting an optional comment.
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
      <LineComment comment="Consider guarding against empty arrays." />
    </div>
  ),
}

export const DisplayMultiline = {
  render: () => (
    <div style={{ width: "400px" }}>
      <LineComment comment={"Consider guarding against empty arrays.\n\nAn early return keeps the happy path flat."} />
    </div>
  ),
}

export const Editor = {
  args: { variant: "default", allowEmpty: false },
  argTypes: {
    variant: { control: "select", options: ["default", "compact"] },
    allowEmpty: { control: "boolean" },
  },
  render: (args) => {
    const [value, setValue] = createSignal("")
    const [result, setResult] = createSignal("")

    return (
      <div style={{ width: "400px" }}>
        <LineCommentEditor
          variant={args.variant}
          allowEmpty={args.allowEmpty}
          value={value()}
          onInput={setValue}
          onCancel={() => {
            setValue("")
            setResult("Cancelled")
          }}
          onSubmit={(comment) => {
            setValue("")
            setResult(`Submitted: ${comment}`)
          }}
        />
        <output aria-label="Editor result">{result()}</output>
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
          autofocus={false}
        />
      </div>
    )
  },
}
