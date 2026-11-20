import { createEffect, createSignal } from "solid-js"
import { LineComment, LineCommentAnchor, LineCommentEditor } from "./line-comment"

const docs = `### Overview
Inline comment anchor and editor for code review or annotation flows.

Pair with \`Diff\` or \`Code\` to align comments to lines.

### API
- \`LineCommentAnchor\`: position with \`top\`, control \`open\`, render custom children.
- \`LineComment\`: convenience wrapper for displaying comment + selection label.
- \`LineCommentEditor\`: controlled textarea with submit/cancel handlers.

### Variants and states
- Default display and editor display variants.

### Behavior
- Anchor positions relative to a containing element.
- Editor submits on Enter (Shift+Enter for newline).

### Accessibility
- TODO: confirm ARIA labeling for comment button and editor textarea.

### Theming/tokens
- Uses \`data-component="line-comment"\` and related slots.

`

export default {
  title: "OpenCode/Review/Line comments",
  id: "components-line-comment",
  component: LineComment,
  args: { inline: false },
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Default = {
  args: { open: true, comment: "Consider guarding against empty arrays.", selection: "L12-L13" },
  render: (args: { inline: boolean; open: boolean; comment: string; selection: string }) => {
    const [open, setOpen] = createSignal(args.open)
    createEffect(() => setOpen(args.open))

    return (
      <div
        style={{
          position: "relative",
          height: "160px",
          padding: "16px 16px 16px 40px",
          border: "1px solid var(--border-weak)",
          "border-radius": "8px",
          "font-family": "var(--font-family-mono)",
          "font-size": "12px",
          color: "var(--text-weak)",
        }}
      >
        <div>12 | const total = sum(values)</div>
        <div>13 | return total / values.length</div>
        <LineComment
          inline={args.inline}
          open={open()}
          top={18}
          comment={args.comment}
          selection={args.selection}
          buttonLabel="Toggle comment"
          onClick={() => setOpen(!open())}
        />
      </div>
    )
  },
}

export const Editor = {
  args: { comment: "Add context for this change.", selection: "L40", mentions: false },
  render: (args: { inline: boolean; comment: string; selection: string; mentions: boolean }) => {
    const [value, setValue] = createSignal(args.comment)
    createEffect(() => setValue(args.comment))

    return (
      <div
        style={{
          position: "relative",
          height: "220px",
          padding: "16px 16px 16px 40px",
          border: "1px solid var(--border-weak)",
          "border-radius": "8px",
          "font-family": "var(--font-family-mono)",
          "font-size": "12px",
          color: "var(--text-weak)",
        }}
      >
        <div>40 | if (values.length === 0) return 0</div>
        <LineCommentEditor
          top={24}
          inline={args.inline}
          value={value()}
          selection={args.selection}
          mention={
            args.mentions
              ? { items: (query) => ["src/sum.ts", "src/sum.test.ts"].filter((path) => path.includes(query)) }
              : undefined
          }
          onInput={setValue}
          onCancel={() => setValue("")}
          onSubmit={(next) => setValue(next)}
        />
      </div>
    )
  },
}

export const AnchorOnly = {
  args: { open: false, icon: "comment" },
  argTypes: { icon: { options: ["comment", "plus"] } },
  render: (args: { inline: boolean; open: boolean; icon: "comment" | "plus" }) => {
    const [open, setOpen] = createSignal(args.open)
    createEffect(() => setOpen(args.open))

    return (
      <div
        style={{
          position: "relative",
          height: "120px",
          padding: "16px 16px 16px 40px",
          border: "1px solid var(--border-weak)",
          "border-radius": "8px",
          "font-family": "var(--font-family-mono)",
          "font-size": "12px",
          color: "var(--text-weak)",
        }}
      >
        <div>20 | const ready = true</div>
        <LineCommentAnchor
          top={18}
          inline={args.inline}
          open={open()}
          icon={args.icon}
          buttonLabel="Toggle comment"
          onClick={() => setOpen(!open())}
        >
          <div data-slot="line-comment-content">Anchor content</div>
        </LineCommentAnchor>
      </div>
    )
  },
}
