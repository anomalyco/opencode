import { useMutation } from "@tanstack/solid-query"
import { createEffect } from "solid-js"
import type { Accessor } from "solid-js"
import type { RemoteClient } from "../sdk"
import type { Wsl, WslInstalledDistro, WslServersState } from "./contract"
import {
  addServerProbePlan,
  createProbeFailureGate,
  runAddableProbePlan,
  type AddServerProbePlan,
  type WslAddServerView,
} from "./model"

export function useWslAddServerProbes(input: {
  state: Accessor<WslServersState | undefined>
  api: () => RemoteClient<(typeof Wsl)["spec"]>
  view: Accessor<WslAddServerView>
  adding: Accessor<boolean>
  busy: Accessor<boolean>
  selectedDistro: Accessor<string | null>
  addableInstalledDistros: Accessor<WslInstalledDistro[]>
  onError: (error: unknown) => void
}) {
  const gate = createProbeFailureGate()
  const probe = useMutation(() => ({
    mutationFn: async (command: AddServerProbePlan) => {
      if (command.kind === "addable") {
        await runAddableProbePlan({
          plan: command.plan,
          probeAddable: (distros) => input.api().probeAddable({ distros }),
        })
        return
      }
      if (command.plan.action === "probeRuntime") await input.api().probeRuntime()
      if (command.plan.action === "refreshDistros") await input.api().refreshDistros()
    },
    onError: input.onError,
    onSettled: (_result, error, command) => {
      if (command) gate.settle(command.key, error)
    },
  }))

  createEffect(() => {
    if (probe.isPending) return
    const command = addServerProbePlan({
      state: input.state(),
      view: input.view(),
      adding: input.adding(),
      busy: input.busy(),
      selectedDistro: input.selectedDistro(),
      addableInstalledDistros: input.addableInstalledDistros(),
    })
    if (!command || !gate.accepts(command.key)) return
    probe.mutate(command)
  })

  return {
    probingAddable: () => probe.isPending && probe.variables?.kind === "addable",
    resetProbeFailure: () => gate.reset(),
  }
}
