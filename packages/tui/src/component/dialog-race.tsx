import { createMemo, createSignal, Match, Switch } from "solid-js"
import { ConfigModelRace } from "@opencode-ai/core/config/model-race"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"

type Screen = "main" | "models" | "warmup" | "window"

export function DialogRace() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [screen, setScreen] = createSignal<Screen>("main")
  const [transitioning, setTransitioning] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [enabledSaving, setEnabledSaving] = createSignal(false)
  const [draft, setDraft] = createSignal<ConfigModelRace.Normalized>(
    ConfigModelRace.normalize(sync.data.config.modelRace),
  )
  const errors = createMemo(() => ConfigModelRace.validate(draft()))

  const goTo = (next: Screen) => {
    if (transitioning()) return
    setTransitioning(true)
    setTimeout(() => {
      setScreen(next)
      setTransitioning(false)
    }, 0)
  }

  useBindings(() => ({
    enabled: screen() !== "main",
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Back to model racing settings",
        group: "Dialog",
        cmd: () => goTo("main"),
      },
    ],
  }))

  const providers = createMemo(() =>
    sync.data.provider
      .flatMap((provider) =>
        Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .map((model) => ({
            id: `${provider.id}/${model.id}`,
            title: model.name ?? model.id,
            provider: provider.name,
          })),
      )
      .toSorted((a, b) => a.provider.localeCompare(b.provider) || a.title.localeCompare(b.title)),
  )

  const patch = (value: Partial<ConfigModelRace.Normalized>) => setDraft((current) => ({ ...current, ...value }))
  const patchStrategy = (key: keyof ConfigModelRace.Normalized["strategy"]) =>
    setDraft((current) => ({ ...current, strategy: { ...current.strategy, [key]: !current.strategy[key] } }))
  const patchThroughput = (key: keyof ConfigModelRace.Normalized["throughput"], value: number) =>
    setDraft((current) => ({ ...current, throughput: { ...current.throughput, [key]: value } }))
  const toggleModel = (id: string) =>
    setDraft((current) => ({
      ...current,
      models: current.models.includes(id) ? current.models.filter((model) => model !== id) : [...current.models, id],
    }))

  const save = async () => {
    const issue = errors()[0]
    if (issue) {
      toast.show({ message: issue, variant: "error" })
      return
    }
    setSaving(true)
    try {
      await sdk.client.global.config.update({ config: { modelRace: draft() } }, { throwOnError: true })
      sync.set("config", "modelRace", draft())
      toast.show({ message: "Model racing configuration saved", variant: "success" })
      dialog.clear()
    } catch (error) {
      toast.error(error)
    } finally {
      setSaving(false)
    }
  }

  const setEnabled = async (value: boolean) => {
    const next = { ...draft(), enabled: value }
    const issue = ConfigModelRace.validate(next)[0]
    if (value && issue) {
      toast.show({ message: issue, variant: "error" })
      return
    }

    const previous = draft().enabled
    setDraft(next)
    setEnabledSaving(true)
    try {
      await sdk.client.global.config.update({ config: { modelRace: { enabled: value } } }, { throwOnError: true })
      sync.set("config", "modelRace", "enabled", value)
    } catch (error) {
      setDraft((current) => ({ ...current, enabled: previous }))
      toast.error(error)
    } finally {
      setEnabledSaving(false)
    }
  }

  const mainOptions = createMemo(() => [
    {
      title: `${draft().enabled ? "[x]" : "[ ]"} Enabled${enabledSaving() ? " (saving...)" : ""}`,
      description: "Race candidate models for each LLM generation",
      value: "enabled",
      onSelect: () => {
        if (saving() || enabledSaving()) return
        void setEnabled(!draft().enabled)
      },
    },
    {
      title: `Candidate models (${draft().models.length})`,
      description: "Select the models that participate in each race",
      value: "models",
    },
    {
      title: `${draft().strategy.firstToken ? "[x]" : "[ ]"} First token leader`,
      description: "Use the first valid token as the provisional leader",
      value: "first-token",
      onSelect: () => patchStrategy("firstToken"),
    },
    {
      title: `${draft().strategy.throughput ? "[x]" : "[ ]"} Throughput switching`,
      description: "Allow a faster sustained model to replace the provisional leader",
      value: "throughput",
      onSelect: () => patchStrategy("throughput"),
    },
    {
      title: `${draft().strategy.toolCall ? "[x]" : "[ ]"} Tool call lock`,
      description: "Lock the race when a candidate emits a complete tool call",
      value: "tool-call",
      onSelect: () => patchStrategy("toolCall"),
    },
    {
      title: `Warmup tokens: ${draft().throughput.warmupTokens}`,
      description: "Tokens ignored before throughput measurement starts",
      value: "warmup",
    },
    {
      title: `Measurement window: ${draft().throughput.measurementWindowMs}ms`,
      description: "Duration of each throughput measurement window",
      value: "window",
    },
    {
      title: `${draft().switch.enabled ? "[x]" : "[ ]"} Allow leader switch`,
      description: "Allow the provisional leader to change during a race",
      value: "switch",
      onSelect: () => setDraft((current) => ({ ...current, switch: { enabled: !current.switch.enabled } })),
    },
    {
      title: saving() ? "Saving…" : "Save",
      description: errors()[0] ?? "Write model racing settings to the global config",
      value: "save",
      disabled: saving() || errors().length > 0,
      onSelect: save,
    },
    {
      title: "Reset to defaults",
      description: "Discard local changes and restore the default model racing settings",
      value: "reset",
      onSelect: () => setDraft(ConfigModelRace.normalize(ConfigModelRace.defaults)),
    },
    {
      title: "Cancel",
      description: "Close without saving",
      value: "cancel",
      onSelect: () => dialog.clear(),
    },
  ])

  const navigateMain = (option: { value: string }) => {
    if (option.value === "models" || option.value === "warmup" || option.value === "window") {
      goTo(option.value)
    }
  }

  const modelOptions = createMemo(() =>
    providers().map((model) => ({
      title: model.title,
      description: model.provider,
      category: model.provider,
      value: model.id,
      footer: draft().models.includes(model.id) ? "selected" : undefined,
      onSelect: () => toggleModel(model.id),
    })),
  )

  return (
    <Switch>
      <Match when={screen() === "main"}>
        <DialogSelect
          title="Model Racing"
          options={mainOptions()}
          flat={true}
          renderFilter={false}
          onSelect={navigateMain}
        />
      </Match>
      <Match when={screen() === "models"}>
        <DialogSelect
          title={`Racing models (${draft().models.length})`}
          options={[
            ...modelOptions(),
            {
              title: "Done",
              description: "Save model selection to the draft and return",
              value: "done",
              onSelect: () => goTo("main"),
            },
          ]}
          flat={true}
        />
      </Match>
      <Match when={screen() === "warmup"}>
        <DialogPrompt
          title="Warmup tokens"
          description={() => <text>Positive integer before throughput measurement starts</text>}
          value={String(draft().throughput.warmupTokens)}
          onConfirm={(value) => {
            const next = Number(value)
            if (!Number.isInteger(next) || next <= 0) {
              toast.show({ message: "Warmup tokens must be a positive integer", variant: "error" })
              return
            }
            patchThroughput("warmupTokens", next)
            goTo("main")
          }}
          onCancel={() => goTo("main")}
        />
      </Match>
      <Match when={screen() === "window"}>
        <DialogPrompt
          title="Measurement window"
          description={() => <text>Duration in milliseconds for each throughput measurement window</text>}
          value={String(draft().throughput.measurementWindowMs)}
          onConfirm={(value) => {
            const next = Number(value)
            if (!Number.isInteger(next) || next <= 0) {
              toast.show({ message: "Measurement window must be a positive integer", variant: "error" })
              return
            }
            patchThroughput("measurementWindowMs", next)
            goTo("main")
          }}
          onCancel={() => goTo("main")}
        />
      </Match>
    </Switch>
  )
}
