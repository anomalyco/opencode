import { createEffect, createSignal, Show } from "solid-js"
import { LineCommentEditor, LineComment, LineCommentOverflowIcon, type LineCommentEditorProps } from "./line-comment"
import { Menu } from "../../navigation/menu/menu"
import { Popover } from "../../components/popover"

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
  args: { comment: "Consider guarding against empty arrays.", selection: "", actions: true, clickable: false },
  render: (args: { comment: string; selection: string; actions: boolean; clickable: boolean }) => {
    const [result, setResult] = createSignal("")

    return (
      <div style={{ width: "min(400px, 100%)" }}>
        <LineComment
          comment={args.comment}
          selection={args.selection}
          onOpen={args.clickable ? () => setResult("Opened") : undefined}
          tabIndex={args.clickable ? 0 : undefined}
          onKeyDown={(event) => {
            if (args.clickable && event.target === event.currentTarget && event.key === "Enter") setResult("Opened")
          }}
          actions={
            args.actions && (
              <Menu gutter={4}>
                <Menu.Trigger
                  as="button"
                  type="button"
                  data-slot="line-comment-v2-overflow"
                  aria-label="Comment actions"
                >
                  <LineCommentOverflowIcon />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item onSelect={() => setResult("Editing")}>Edit</Menu.Item>
                    <Menu.Item onSelect={() => setResult("Deleted")}>Delete</Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            )
          }
        />
        <output>{result()}</output>
      </div>
    )
  },
}

export const DisplayWithoutActions = {
  args: { ...Display.args, actions: false },
  render: Display.render,
}

export const DisplayMultiline = {
  args: {
    ...DisplayWithoutActions.args,
    comment: `${Display.args.comment}\n\nAn early return keeps the happy path flat.`,
  },
  render: Display.render,
}

const editor = {
  variant: "default",
  value: "",
  selection: "",
  allowEmpty: false,
  alternateSubmit: false,
  alternateDisabled: false,
  submitting: false,
  autofocus: true,
  placeholder: "",
  label: "",
  cancelLabel: "",
  submitLabel: "",
  rows: 0,
  mentions: false,
  popover: false,
}

export const Editor = {
  args: editor,
  argTypes: {
    variant: { control: "select", options: ["default", "compact"] },
    rows: { control: { type: "range", min: 0, max: 10, step: 1 } },
  },
  render: (args: Omit<typeof editor, "variant"> & Pick<LineCommentEditorProps, "variant">) => {
    const [value, setValue] = createSignal(args.value)

    const [result, setResult] = createSignal("")

    const pending: (() => void)[] = []

    const files = ["src/app.ts", "src/api.ts", "src/server.ts"]

    createEffect(() => setValue(args.value))

    const content = () => (
      <div style={{ width: args.popover ? "360px" : "min(400px, 100%)" }}>
        <LineCommentEditor
          variant={args.variant}
          autofocus={args.autofocus}
          selection={args.selection}
          submitting={args.submitting}
          placeholder={args.placeholder || undefined}
          label={args.label || undefined}
          cancelLabel={args.cancelLabel || undefined}
          submitLabel={args.submitLabel || undefined}
          rows={args.rows || undefined}
          allowEmpty={args.allowEmpty}
          value={value()}
          onInput={setValue}
          onCancel={() => {
            if (!args.popover) setValue("")
            setResult("Cancelled")
          }}
          onSubmit={(comment) => {
            if (!args.popover) setValue("")
            setResult(`Submitted: ${comment}`)
          }}
          alternateSubmit={
            args.alternateSubmit
              ? {
                  label: "Send",
                  keys: ["Ctrl", "Enter"],
                  disabled: args.alternateDisabled,
                  onSubmit: (comment) => {
                    setValue("")
                    setResult(`Sent: ${comment}`)
                  },
                }
              : undefined
          }
          mention={
            args.mentions
              ? {
                  items: (query) =>
                    new Promise<string[]>((resolve) =>
                      pending.push(() => resolve(files.filter((file) => file.includes(query)))),
                    ),
                }
              : undefined
          }
        />
        <Show when={args.mentions}>
          <button type="button" onClick={() => pending.splice(0).forEach((finish) => finish())}>
            Finish search
          </button>
        </Show>
      </div>
    )

    return (
      <div>
        <Show when={args.popover} fallback={content()}>
          <Popover trigger="Open editor" triggerAs="button" portal={false}>
            {content()}
          </Popover>
        </Show>
        <output aria-label="Editor result">{result()}</output>
      </div>
    )
  },
}

export const EditorFilled = {
  args: { ...editor, autofocus: false, value: "Use a sentinel or early return when the list is empty." },
  render: Editor.render,
}

/** File search answers only when "Finish search" is pressed, so the loading state can be explored. */
export const EditorWithMentions = {
  args: { ...editor, mentions: true },
  render: Editor.render,
}

/** An editor inside a popover: Escape in the field cancels the comment, and Escape on its buttons closes the popover. */
export const EditorInPopover = {
  args: { ...editor, popover: true },
  render: Editor.render,
}
