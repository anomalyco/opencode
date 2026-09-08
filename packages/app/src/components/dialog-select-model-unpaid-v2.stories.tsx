// @ts-nocheck
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, onMount } from "solid-js"
import { DialogSelectModelUnpaidV2 } from "./dialog-select-model-unpaid-v2"

const names = [
  "MiMo V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Deepseek V4 Flash Free",
  "North Mini Code Free",
  "Hy3 Free",
  "Big Pickle",
]

function SelectModelWithoutProviders() {
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
    list: () => models,
    current,
    set(value) {
      setCurrent(models.find((item) => item.id === value?.modelID))
    },
  }
  const open = () => dialog.show(() => <DialogSelectModelUnpaidV2 model={model} />)

  onMount(open)

  return (
    <Button variant="secondary" onClick={open}>
      Open select model dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/Select Model",
  id: "app-dialog-select-model",
}

export const WithoutProviders = {
  render: () => <SelectModelWithoutProviders />,
}
