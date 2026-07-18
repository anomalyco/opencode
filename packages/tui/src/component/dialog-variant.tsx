import { createMemo, Show } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { resolveVariantApply } from "./dialog-model-flow"

export function listModelVariants(
  providers: { id: string; models: Record<string, { variants?: Record<string, unknown> }> }[],
  model: { providerID: string; modelID: string },
) {
  const provider = providers.find((item) => item.id === model.providerID)
  const info = provider?.models[model.modelID]
  if (!info?.variants) return [] as string[]
  return Object.keys(info.variants)
}

export function DialogVariant(props: {
  /** When set, opened from the model picker: Enter applies model + variant; Esc returns. */
  model?: { providerID: string; modelID: string }
  onSelect?: (providerID: string, modelID: string) => void | Promise<void>
} = {}) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const fromModelPicker = () => !!props.model

  const variants = createMemo(() => {
    if (props.model) return listModelVariants(sync.data.provider, props.model)
    return local.model.variant.list()
  })

  const options = createMemo(() => {
    const apply = (variant: string | undefined) => {
      const action = resolveVariantApply({
        model: props.model,
        configPicker: !!props.onSelect,
        variant,
      })
      if (action.type === "config-callback") {
        // Config pickers only report the model; do not mutate the session model.
        void props.onSelect?.(action.model.providerID, action.model.modelID)
        dialog.clear()
        return
      }
      if (action.type === "set-model-and-variant") {
        // Set model first so variant.set targets the chosen model, then close the stack.
        local.model.set(action.model, { recent: true })
        local.model.variant.set(action.variant)
        dialog.clear()
        return
      }
      dialog.clear()
      local.model.variant.set(action.variant)
    }

    return [
      {
        value: "default",
        title: "Default",
        onSelect: () => apply(undefined),
      },
      ...variants().map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => apply(variant),
      })),
    ]
  })

  const current = createMemo(() => {
    if (props.model) {
      // Peek the stored variant for this model without switching the active model.
      const active = local.model.current()
      if (
        active &&
        active.providerID === props.model.providerID &&
        active.modelID === props.model.modelID
      ) {
        return local.model.variant.selected()
      }
      return "default"
    }
    return local.model.variant.selected()
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <DialogSelect<string>
        options={options()}
        title="Select variant"
        current={current()}
        flat={true}
      />
      <Show when={fromModelPicker() && props.model}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.textMuted}>
            {props.model!.providerID}/{props.model!.modelID} · esc back · enter select model + variant
          </text>
        </box>
      </Show>
    </box>
  )
}
