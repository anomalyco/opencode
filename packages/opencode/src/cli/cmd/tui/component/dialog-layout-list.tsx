import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useLayout } from "../context/layout"
import { useDialog } from "../ui/dialog"
import { createSignal, onCleanup, onMount } from "solid-js"

export function DialogLayoutList() {
  const layout = useLayout()
  const [options, setOptions] = createSignal(
    Object.keys(layout.all()).map((value) => ({
      title: value,
      value: value,
    })),
  )
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = layout.selected

  onMount(async () => {
    // Reload layouts when dialog opens
    await layout.reload()
    setOptions(
      Object.keys(layout.all()).map((value) => ({
        title: value,
        value: value,
      })),
    )
  })

  onCleanup(() => {
    if (!confirmed) layout.set(initial)
  })

  return (
    <DialogSelect
      title="Layouts"
      options={options()}
      current={initial}
      onMove={(opt) => {
        layout.set(opt.value)
      }}
      onSelect={(opt) => {
        layout.set(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          layout.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) layout.set(first.value)
      }}
    />
  )
}
