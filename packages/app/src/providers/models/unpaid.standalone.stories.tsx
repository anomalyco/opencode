import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, onMount } from "solid-js"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import { isFreeModel } from "./models"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { DialogSelectModelUnpaid } from "./unpaid"

const names = [
  "MiMo V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Deepseek V4 Flash Free",
  "North Mini Code Free",
  "Hy3 Free",
  "Big Pickle",
]

function SelectModelWithoutProviders(props: { count: number }) {
  const dialog = useDialog()

  const local = useLocal()

  const models = createMemo(() => {
    const free = local.model.list().find(isFreeModel)

    if (!free) return []

    return names.slice(0, props.count).map((name, index) => ({
      ...free,
      id: name.toLowerCase().replaceAll(" ", "-"),
      name,
      provider: { ...free.provider, name: "OpenCode" },
      limit: { ...free.limit, context: 128_000 },
      capabilities: {
        ...free.capabilities,
        reasoning: index !== 5,
        input: { text: true, image: false, audio: false, video: false, pdf: false },
      },
    }))
  })

  const [selected, setSelected] = createSignal<string | undefined>("deepseek-v4-flash-free")

  const model = {
    ...local.model,
    list: models,
    current: () => models().find((item) => item.id === selected()),
    set: (key) => setSelected(key?.modelID),
  } satisfies ModelSelection

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
  argTypes: { count: { control: { type: "range", min: 0, max: names.length, step: 1 } } },
  render: (args: { count: number }) => (
    <DialogStoryRuntime>
      <SelectModelWithoutProviders count={args.count} />
    </DialogStoryRuntime>
  ),
}

export const WithoutProviders = {}

export const NoFreeModels = { args: { count: 0 } }
