// @ts-nocheck
import { createSignal } from "solid-js"
import { LineCommentEditor, LineComment } from "./line-comment"

const docs = `### Overview
Line comment **display** and **editor** cards aligned with OpenCode line-comment specs (raised \`#FAFAFA\` surface, small \`Button\` ghost + contrast actions).

### Display
- \`LineComment\`: body + optional meta. The body keeps its line breaks. With \`onOpen\`, the whole card is a button (e.g. to edit the comment).

### Editor
- \`LineCommentEditor\`: the card is the text field, with a footer (optional selection meta or \`deleteAction\` + Cancel / Comment). \`label\` names the field (default “Comment”).
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
  render: () => {
    const [opened, setOpened] = createSignal(0)

    return (
      <div style={{ width: "400px" }}>
        <LineComment
          comment={
            opened()
              ? `Consider guarding against empty arrays. (opened ${opened()}x)`
              : "Consider guarding against empty arrays."
          }
          onOpen={() => setOpened(opened() + 1)}
        />
      </div>
    )
  },
}

export const DisplayMultiline = {
  render: () => (
    <div style={{ width: "400px" }}>
      <LineComment comment={"Consider guarding against empty arrays.\n\nAn early return keeps the happy path flat."} />
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
          autofocus={false}
        />
      </div>
    )
  },
}
