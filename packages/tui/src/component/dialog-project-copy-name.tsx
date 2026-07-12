import { InputRenderable, TextAttributes } from "@opentui/core"
import { Slug } from "@opencode-ai/core/util/slug"
import { createSignal, onMount } from "solid-js"
import { useTuiConfig } from "../config/v1"
import { useTheme } from "../context/theme"
import { useBindings, useCommandShortcut } from "../keymap"
import { useDialog, type DialogContext } from "../ui/dialog"

export function DialogProjectCopyName(props: { onConfirm: (name: string) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const generateShortcut = useCommandShortcut("dialog.project_copy.generate")
  const [inputTarget, setInputTarget] = createSignal<InputRenderable>()
  let input: InputRenderable

  function generate() {
    input.value = Slug.create()
    input.gotoLineEnd()
  }

  function confirm() {
    props.onConfirm(slugify(input.value) || Slug.create())
  }

  useBindings(() => ({
    target: inputTarget,
    enabled: inputTarget() !== undefined,
    priority: 1,
    commands: [
      {
        name: "dialog.project_copy.generate",
        title: "Generate project copy name",
        category: "Dialog",
        run: generate,
      },
    ],
    bindings: tuiConfig.keybinds.get("dialog.project_copy.generate"),
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
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Name project copy
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
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
        placeholderColor={theme.textMuted}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.text}
      />
      <box paddingBottom={1} flexDirection="row" gap={2}>
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
        <text fg={theme.text}>
          {generateShortcut()} <span style={{ fg: theme.textMuted }}>generate one</span>
        </text>
      </box>
    </box>
  )
}

DialogProjectCopyName.show = (dialog: DialogContext) =>
  new Promise<string | null>((resolve) => {
    dialog.replace(() => <DialogProjectCopyName onConfirm={resolve} />, () => resolve(null))
  })

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
