import { createMemo } from "solid-js"
import { useNewDesigns } from "../config"
import { useLocal } from "../context/local"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { Locale } from "../util/locale"

export function DialogSpeed() {
  const local = useLocal()
  const dialog = useDialog()
  const newDesigns = useNewDesigns()

  // Slowest to fastest, with the model's standard speed between the slower and the faster ones.
  const options = createMemo(() => {
    const speeds = local.model.speed.list()
    const option = (speed: (typeof speeds)[number]) => ({
      value: speed.id,
      title: Locale.titlecase(speed.id),
      footer: speed.price === undefined ? undefined : `${Number(speed.price.toFixed(2))}× price`,
      onSelect: () => {
        dialog.clear()
        local.model.speed.set(speed.id)
      },
    })
    return [
      ...speeds.filter((speed) => !speed.faster).map(option),
      {
        value: "standard",
        title: "Standard",
        onSelect: () => {
          dialog.clear()
          local.model.speed.set(undefined)
        },
      },
      ...speeds.filter((speed) => speed.faster).map(option),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={"Select speed"}
      renderFilter={!newDesigns()}
      current={local.model.speed.current() ?? "standard"}
      flat={true}
    />
  )
}
