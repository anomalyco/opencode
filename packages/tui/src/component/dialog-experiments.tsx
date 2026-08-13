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
    description: "Keep unsent prompt drafts on the tab where they were written. New sessions start blank.",
  },
]

export function DialogExperiments() {
  const config = useConfig()
  const toast = useToast()
  const [selected, setSelected] = createSignal(0)
  const [saving, setSaving] = createSignal(false)

  const enabled = (experiment: Experiment) => config.data.experimental?.[experiment.id] === true

  const options = createMemo(() =>
    experiments.map((experiment, index) => ({
      title: experiment.title,
      category: "Experiments",
      searchText: experiment.description,
      footer: enabled(experiment) ? "on" : "off",
      value: index,
    })),
  )

  // All experiments are booleans, so either direction toggles.
  async function change(index = selected()) {
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
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => void change(option.value)}
      footerHints={[{ title: "←/→", label: "change" }]}
      bindings={[
        {
          bind: "left",
          title: "Previous value",
          group: "Experiments",
          run: () => void change(),
        },
        {
          bind: "right",
          title: "Next value",
          group: "Experiments",
          run: () => void change(),
        },
      ]}
    />
  )
}
