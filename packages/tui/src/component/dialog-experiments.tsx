import type { TranslationKey } from "../i18n/translate"
import { useLanguage } from "../context/language"
import { createMemo, createSignal } from "solid-js"
import { useConfig, useNewDesigns } from "../config"
import { DIALOG_LIST_INSET } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"

type Experiment = {
  id: string
  title: TranslationKey
  description: TranslationKey
}

// In-flight features anyone can opt into. Each entry is temporary: an
// experiment either graduates (delete the entry, make the behavior
// unconditional) or dies (delete the entry and the branch it gated).
export const experiments: Experiment[] = [
  {
    id: "new-designs",
    title: "tui.experiments.newDesigns",
    description: "tui.experiments.newDesignsDescription",
  },
  {
    id: "client-mcp",
    title: "tui.experiments.tools",
    description: "tui.experiments.toolsDescription",
  },
]

export function DialogExperiments() {
  const language = useLanguage()
  const config = useConfig()
  const newDesigns = useNewDesigns()
  const theme = useTheme()
  const toast = useToast()
  const [selected, setSelected] = createSignal<Experiment>()
  const [saving, setSaving] = createSignal(false)

  const enabled = (experiment: Experiment) => config.data.experimental?.[experiment.id] === true

  const options = createMemo(() =>
    experiments.map((experiment) => ({
      title: language.t(experiment.title),
      searchText: language.t(experiment.description),
      footer: language.t(enabled(experiment) ? "tui.on" : "tui.off"),
      value: experiment,
    })),
  )

  // All experiments are booleans, so either direction toggles.
  async function change(experiment = selected()) {
    if (saving()) return
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
      title={language.t("tui.details.experiments")}
      options={options()}
      renderFilter={experiments.length > 0}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => void change(option.value)}
      emptyView={
        <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
          <text fg={theme.text.muted}>{language.t("tui.details.noExperimentsAvailable")}</text>
        </box>
      }
      footerHints={experiments.length > 0 && !newDesigns() ? [{ title: language.t("tui.change"), label: "←/→" }] : []}
      bindings={
        experiments.length > 0
          ? [
              {
                bind: "left",
                title: language.t("tui.previousValue"),
                group: language.t("tui.details.experiments"),
                run: () => void change(),
              },
              {
                bind: "right",
                title: language.t("tui.nextValue"),
                group: language.t("tui.details.experiments"),
                run: () => void change(),
              },
            ]
          : []
      }
    />
  )
}
