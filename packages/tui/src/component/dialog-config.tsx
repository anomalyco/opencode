import { createMemo, Show } from "solid-js"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogNote } from "./dialog-note"
import { DialogFallback } from "./dialog-fallback"
import { Locale } from "../util/locale"
import { get as getModel, isVisionCapable } from "../util/model"
import { modelKey } from "../util/attachment-fallback"
import { visionFallbackConfigRows } from "./dialog-config-flow"

type ModelRef = { providerID: string; modelID: string }

// Per-model edit submenu. Reached via `model.dialog.config` (key `c`) from the
// model list. The submenu does NOT pop after a direct toggle so the user can
// adjust multiple settings in one visit; `dialog.push`-based entries
// (Note, vision-fallback picker) naturally return to the submenu when their
// inner dialog closes.
export function DialogConfig(props: { model: ModelRef }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const model = props.model
  const key = modelKey(model)

  const isFavorited = createMemo(() =>
    local.model.favorite().some((f) => f.providerID === model.providerID && f.modelID === model.modelID),
  )
  const isHidden = createMemo(() => local.model.isHidden(model))
  const currentNote = createMemo(() => local.model.note(model))

  // Look up the model's capabilities so the vision-fallback section can show
  // an informational row for vision-capable models (no fallback needed)
  // instead of Set / Clear.
  const modelInfo = createMemo(() => getModel(sync.data.provider, model.providerID, model.modelID))
  const visionCapable = createMemo(() => {
    const info = modelInfo()
    return info ? isVisionCapable(info) : false
  })

  // Effective state for the vision-fallback section
  const globalFallback = createMemo(() => local.model.attachmentFallback())
  const perModelEntry = createMemo(() => local.model.modelAttachmentFallback(model))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list: DialogSelectOption<string>[] = []

    // Set / Clear favorite: mutually exclusive pair. The action verb already
    // conveys current state (Set = currently off, Clear = currently on), so no
    // parenthetical is needed.
    if (isFavorited()) {
      list.push({
        value: "clear-favorite",
        title: "Clear favorite",
        onSelect: () => local.model.toggleFavorite(model),
      })
    } else {
      list.push({
        value: "set-favorite",
        title: "Set favorite",
        onSelect: () => local.model.toggleFavorite(model),
      })
    }

    // Set / Clear hidden: same pattern
    if (isHidden()) {
      list.push({
        value: "clear-hidden",
        title: "Clear hidden",
        onSelect: () => local.model.toggleHidden(model),
      })
    } else {
      list.push({
        value: "set-hidden",
        title: "Set hidden",
        onSelect: () => local.model.toggleHidden(model),
      })
    }

    // Note: pushes DialogNote
    const noteText = currentNote()
    const noteTitle = noteText
      ? `Note: ${Locale.truncate(noteText, 30)}`
      : "Add note"
    list.push({
      value: "note",
      title: noteTitle,
      onSelect: () => dialog.push(() => <DialogNote model={model} />),
    })

    // Vision-fallback section (per-model only). The global default is
    // configured via the `/vision-fallback` slash command, not here.
    for (const row of visionFallbackConfigRows({
      visionCapable: visionCapable(),
      global: globalFallback(),
      perModelEntry: perModelEntry(),
    })) {
      if (row.value === "clear-model-fallback") {
        list.push({
          value: row.value,
          title: row.title,
          onSelect: () => local.model.clearModelAttachmentFallback(model),
        })
        continue
      }
      if (row.value === "set-model-fallback") {
        list.push({
          value: row.value,
          title: row.title,
          onSelect: () =>
            dialog.push(() => (
              <DialogFallback
                title={`Set fallback for ${key}`}
                current={globalFallback() ?? null}
                commit={(target) => {
                  if (target) local.model.setModelAttachmentFallback(model, target)
                }}
              />
            )),
        })
        continue
      }
      if (row.value === "opt-out-model-fallback") {
        list.push({
          value: row.value,
          title: row.title,
          onSelect: () => local.model.setModelAttachmentFallback(model, null),
        })
        continue
      }
      // Vision-capable informational row — no onSelect (Enter is a no-op).
      list.push({ value: row.value, title: row.title })
    }

    return list
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <DialogSelect<string>
        options={options()}
        title={`Edit ${model.providerID}/${model.modelID}`}
        flat={true}
      />
      <Show when={true}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.textMuted}>esc back · enter select</text>
        </box>
      </Show>
    </box>
  )
}
