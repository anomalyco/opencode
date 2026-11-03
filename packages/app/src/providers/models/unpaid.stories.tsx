// @ts-nocheck
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, onMount } from "solid-js"
import { DialogSelectModelUnpaid } from "./unpaid"

const names = [
  "MiMo V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Deepseek V4 Flash Free",
  "North Mini Code Free",
  "Hy3 Free",
  "Big Pickle",
]

function SelectModelWithoutProviders(props) {
  const dialog = useDialog()

  const models = names.map((name, index) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    provider: { id: "opencode", name: "OpenCode" },
    cost: { input: 0, output: 0 },
    limit: { context: 128_000 },
    capabilities: {
      reasoning: index !== 5,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
    },
  }))

  const [current, setCurrent] = createSignal(models[2])

  const model = {
    list: () => models.slice(0, props.count),
    current,
    set(value) {
      setCurrent(models.find((item) => item.id === value?.modelID))
    },
  }

  const open = () => dialog.show(() => <DialogSelectModelUnpaid model={model} />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open select model dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/Select Model",
  id: "app-dialog-select-model",
  args: { count: names.length },
  argTypes: { count: { control: { type: "range", min: 1, max: names.length, step: 1 } } },
}

export const WithoutProviders = {
  render: (args) => <SelectModelWithoutProviders count={args.count} />,
}
