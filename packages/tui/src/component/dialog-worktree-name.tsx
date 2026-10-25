import { Slug } from "@opencode/core/util/slug"
import { useNewDesigns } from "../config"
import { type DialogContext } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"

export function DialogWorktreeName(props: { onConfirm: (name: string) => void }) {
  const newDesigns = useNewDesigns()
  return (
    <DialogPrompt
      title="Name worktree"
      placeholder="Worktree name"
      onConfirm={(value) => props.onConfirm(slugify(value) || Slug.create())}
      actions={[
        {
          title: newDesigns() ? "generate name" : "generate one",
          command: "dialog.worktree.generate",
          commandTitle: "Generate worktree name",
          onTrigger: (prompt) => prompt.setValue(Slug.create()),
        },
      ]}
    />
  )
}

DialogWorktreeName.show = (dialog: DialogContext) =>
  new Promise<string | null>((resolve) => {
    dialog.replace(
      () => <DialogWorktreeName onConfirm={resolve} />,
      () => resolve(null),
    )
  })

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
