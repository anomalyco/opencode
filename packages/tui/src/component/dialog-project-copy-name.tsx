import { InputRenderable, TextAttributes } from "@opentui/core"
import { Slug } from "@opencode-ai/core/util/slug"
import { createSignal, onMount } from "solid-js"
import { Keymap } from "../context/keymap"
import { useThemes } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"

export function DialogProjectCopyName(props: { onConfirm: (name: string) => void }) {
  const dialog = useDialog()
  const theme = useThemes().contextual("elevated")
  const shortcuts = Keymap.useShortcuts()
  const [inputTarget, setInputTarget] = createSignal<InputRenderable>()
  let input: InputRenderable

  function generate() {
    input.value = Slug.create()
    input.gotoLineEnd()
  }

  function confirm() {
    props.onConfirm(slugify(input.value) || Slug.create())
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target: inputTarget,
    enabled: inputTarget() !== undefined,
    priority: 1,
    commands: [
      {
        id: "dialog.project_copy.generate",
        title: "Generate project copy name",
        group: "Dialog",
        run: generate,
      },
    ],
  }))

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          Name project copy
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <input
        ref={(value: InputRenderable) => {
          input = value
          setInputTarget(value)
        }}
        onSubmit={confirm}
        placeholder="Project copy name"
        placeholderColor={theme.text.subdued}
        textColor={theme.text.formfield.default}
        focusedTextColor={theme.text.formfield.default}
        cursorColor={theme.text.formfield.default}
      />
      <box paddingBottom={1} flexDirection="row" gap={2}>
        <text fg={theme.text.default}>
          enter <span style={{ fg: theme.text.subdued }}>submit</span>
        </text>
        <text fg={theme.text.default}>
          {shortcuts.get("dialog.project_copy.generate")} <span style={{ fg: theme.text.subdued }}>generate one</span>
        </text>
      </box>
    </box>
  )
}

DialogProjectCopyName.show = (dialog: DialogContext) =>
  new Promise<string | null>((resolve) => {
    dialog.replace(
      () => <DialogProjectCopyName onConfirm={resolve} />,
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
