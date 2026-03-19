import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { pipe, flatMap, entries, sortBy } from "remeda"

type ModelOption = { providerID: string; modelID: string }

function ModelPicker(props: {
  title: string
  current?: string
  onSelect: (model: ModelOption) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const options = createMemo(() => {
    return pipe(
      sync.data.provider,
      flatMap((provider) =>
        pipe(
          entries(provider.models),
          sortBy(([, m]) => m.name ?? ""),
          flatMap(([modelID, model]) => [
            {
              key: { providerID: provider.id, modelID },
              value: { providerID: provider.id, modelID },
              title: model.name ?? modelID,
              description: provider.name,
              category: provider.name,
            },
          ]),
        ),
      ),
    )
  })

  return (
    <DialogSelect
      title={props.title}
      footer={props.current ? `Current: ${props.current}` : undefined}
      options={options()}
      onSelect={(value) => {
        props.onSelect(value)
        dialog.clear()
      }}
      onFilter={setQuery}
    />
  )
}

export function DialogParallelConfig() {
  const sync = useSync()
  const dialog = useDialog()

  const config = createMemo(() => sync.data.config)

  const maxWorkersOptions = [1, 2, 3, 4, 5, 8, 10, 15, 20].map((n) => ({
    key: String(n),
    value: String(n),
    title: `${n} worker${n > 1 ? "s" : ""}`,
    description: n === 20 ? "Maximum" : undefined,
    category: "Max Workers",
  }))

  const options = createMemo(() => [
    {
      key: "orchestrator",
      value: "orchestrator",
      title: "Orchestrator model",
      description: config().parallel?.orchestrator_model ?? "Using project default",
      category: "Parallel Models",
    },
    {
      key: "worker",
      value: "worker",
      title: "Default worker model",
      description: config().parallel?.worker_model ?? "Using project default",
      category: "Parallel Models",
    },
    {
      key: "max_workers",
      value: "max_workers",
      title: "Max parallel workers",
      description: config().parallel?.max_workers ? `${config().parallel!.max_workers}` : "Unlimited",
      category: "Concurrency",
    },
  ])

  return (
    <DialogSelect
      title="Parallel Agent Config"
      options={options()}
      onSelect={(value) => {
        if (value === "orchestrator") {
          dialog.replace(() => (
            <ModelPicker
              title="Orchestrator Model"
              current={config().parallel?.orchestrator_model}
              onSelect={async (model) => {
                const { Config } = await import("@/config/config")
                await Config.update({
                  parallel: {
                    ...config().parallel,
                    orchestrator_model: `${model.providerID}/${model.modelID}`,
                  },
                })
              }}
            />
          ))
        } else if (value === "max_workers") {
          dialog.replace(() => (
            <DialogSelect
              title="Max Parallel Workers"
              footer={`Current: ${config().parallel?.max_workers ?? "Unlimited"}`}
              options={[
                { key: "unlimited", value: "unlimited", title: "Unlimited", description: "All subtasks at once", category: "Max Workers" },
                ...maxWorkersOptions,
              ]}
              onSelect={async (val) => {
                const { Config } = await import("@/config/config")
                const max = val === "unlimited" ? undefined : parseInt(val)
                await Config.update({
                  parallel: {
                    ...config().parallel,
                    max_workers: max,
                  },
                })
                dialog.clear()
              }}
            />
          ))
        } else if (value === "worker") {
          dialog.replace(() => (
            <ModelPicker
              title="Default Worker Model"
              current={config().parallel?.worker_model}
              onSelect={async (model) => {
                const { Config } = await import("@/config/config")
                await Config.update({
                  parallel: {
                    ...config().parallel,
                    worker_model: `${model.providerID}/${model.modelID}`,
                  },
                })
              }}
            />
          ))
        }
      }}
    />
  )
}
