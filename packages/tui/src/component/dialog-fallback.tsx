import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { fallbackPickerRows, listVisionCapableModels } from "./dialog-fallback-flow"

type ModelRef = { providerID: string; modelID: string }

// Stateless vision-capable model picker. `DialogConfig` decides whether the
// picked target sets the global or a per-model override by supplying `commit`.
// To expose a "clear" action in the picker (e.g. clear the global, or opt
// a model out of the global), supply `clearLabel` + `onClear`; the picker
// inserts a `Clear …` entry between the `Currently:` label and the model list.
// Targets must support `input.image` / `input.pdf` (runtime describe side-pass).
export function DialogFallback(props: {
  commit?: (target: ModelRef | null) => void
  current?: ModelRef | null
  title?: string
  clearLabel?: string
  onClear?: () => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const commit = props.commit ?? (() => {})
  const visionModels = createMemo(() => listVisionCapableModels(sync.data.provider))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const rows = fallbackPickerRows({
      current: props.current,
      clearLabel: props.clearLabel && props.onClear ? props.clearLabel : undefined,
      models: visionModels(),
    })
    return rows.map((row) => {
      if (row.value === "__current__") {
        return { value: row.value, title: row.title }
      }
      if (row.value === "__clear__") {
        return {
          value: row.value,
          title: row.title,
          onSelect: () => {
            props.onClear!()
            // Pop back to the caller (DialogConfig or the prompt) rather
            // than closing the entire dialog stack — the caller pushed us.
            dialog.pop()
          },
        }
      }
      const target = row.model
      return {
        value: row.value,
        title: row.title,
        category: row.category,
        onSelect: () => {
          if (target) commit(target)
          // Pop back to the caller; the caller pushed us.
          dialog.pop()
        },
      }
    })
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <DialogSelect<string>
        options={options()}
        title={props.title ?? "Vision fallback"}
        flat={true}
      />
      <Show when={true}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            esc back · enter select
          </text>
        </box>
      </Show>
    </box>
  )
}
