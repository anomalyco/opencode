import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { pipe, flatMap, entries, sortBy, map, filter } from "remeda"

function ModelPicker(props: { title: string; field: "orchestrator_model" | "worker_model" }) {
  const sync = useSync()
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    pipe(
      sync.data.provider,
      sortBy((p) => p.name),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          sortBy(([, m]) => m.name ?? ""),
          map(([modelID, model]) => ({
            value: `${provider.id}/${modelID}`,
            title: model.name ?? modelID,
            description: provider.name,
            category: provider.name,
            onSelect() {
              dialog.clear()
              const modelStr = `${provider.id}/${modelID}`
              if (props.field === "orchestrator_model") local.parallel.setOrchestratorModel(modelStr)
              else local.parallel.setWorkerModel(modelStr)
            },
          })),
        ),
      ),
    ),
  )

  return <DialogSelect title={props.title} options={options()} />
}

export function DialogParallelConfig() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      value: "orchestrator",
      title: "Orchestrator model",
      description: local.parallel.orchestrator_model ?? "Using project default",
      category: "Parallel Models",
      onSelect() {
        dialog.replace(() => <ModelPicker title="Orchestrator Model" field="orchestrator_model" />)
      },
    },
    {
      value: "worker",
      title: "Default worker model",
      description: local.parallel.worker_model ?? "Using project default",
      category: "Parallel Models",
      onSelect() {
        dialog.replace(() => <ModelPicker title="Default Worker Model" field="worker_model" />)
      },
    },
    {
      value: "max_workers",
      title: "Max parallel workers",
      description: local.parallel.max_workers ? `${local.parallel.max_workers}` : "Unlimited",
      category: "Concurrency",
      onSelect() {
        dialog.replace(() => (
          <DialogSelect
            title="Max Parallel Workers"
            options={[
              {
                value: 0,
                title: "Unlimited",
                description: "All subtasks run at once",
                category: "Max Workers",
                onSelect() {
                  dialog.clear()
                  local.parallel.setMaxWorkers(undefined)
                },
              },
              ...[1, 2, 3, 4, 5, 8, 10, 15, 20].map((n) => ({
                value: n,
                title: `${n} worker${n > 1 ? "s" : ""}`,
                description: n === 1 ? "Sequential" : n === 20 ? "Maximum" : undefined,
                category: "Max Workers",
                onSelect() {
                  dialog.clear()
                  local.parallel.setMaxWorkers(n)
                },
              })),
            ]}
          />
        ))
      },
    },
  ])

  return <DialogSelect title="Parallel Agent Config" options={options()} />
}
