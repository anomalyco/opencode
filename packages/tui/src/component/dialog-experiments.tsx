import { createMemo, createSignal } from "solid-js"
import { useConfig } from "../config"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

type Experiment = {
  id: "tab_drafts"
  title: string
  description: string
}

// In-flight features anyone can opt into. Each entry is temporary: an
// experiment either graduates (delete the entry, make the behavior
// unconditional) or dies (delete the entry and the branch it gated).
export const experiments: Experiment[] = [
  {
    id: "tab_drafts",
    title: "Per-tab prompt drafts",
    description: "Keep unsent prompt drafts on the tab where they were written. New session moves the current draft.",
  },
]

export function DialogExperiments() {
  const config = useConfig()
  const toast = useToast()
  const [saving, setSaving] = createSignal(false)

  const enabled = (experiment: Experiment) => config.data.experimental?.[experiment.id] === true

  const options = createMemo(() =>
    experiments.map((experiment, index) => ({
      title: experiment.title,
      description: experiment.description,
      category: "Experiments",
      footer: enabled(experiment) ? "on" : "off",
      value: index,
    })),
  )

  async function toggle(index: number) {
    if (saving()) return
    const experiment = experiments[index]
    if (!experiment) return
    const next = !enabled(experiment)
    setSaving(true)
    await config
      .update((draft) => {
        if (!draft.experimental || typeof draft.experimental !== "object") draft.experimental = {}
        draft.experimental[experiment.id] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title="Experiments"
      options={options()}
      onSelect={(option) => void toggle(option.value)}
      footerHints={[{ title: "enter", label: "toggle" }]}
    />
  )
}
