import { InputRenderable, TextAttributes } from "@opentui/core"
import { Slug } from "@opencode-ai/core/util/slug"
import { createSignal, onMount } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"

export function DialogProjectCopyName(props: { onConfirm: (name: string) => void }) {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")
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
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          Name project copy
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
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
        placeholderColor={themeV2.text.subdued()}
        textColor={themeV2.text.formfield()}
        focusedTextColor={themeV2.text.formfield()}
        cursorColor={themeV2.text.formfield()}
      />
      <box paddingBottom={1} flexDirection="row" gap={2}>
        <text fg={themeV2.text()}>
          enter <span style={{ fg: themeV2.text.subdued() }}>submit</span>
        </text>
        <text fg={themeV2.text()}>
          {shortcuts.get("dialog.project_copy.generate")}{" "}
          <span style={{ fg: themeV2.text.subdued() }}>generate one</span>
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
