import { createSignal, onCleanup, untrack } from "solid-js"
import type { Accessor } from "solid-js"
import { createKeyed, type IpcClient } from "@opencode/plugin/gui"
import type { Wsl, WslInstalledDistro, WslServersState } from "./contract"
import { addServerProbePlan, type AddServerProbePlan, type WslAddServerView } from "./model"
import {
  createWslProbeState,
  selectWslProbingAddable,
  transitionWslProbes,
  type WslProbeEffect,
  type WslProbeEvent,
  type WslProbeInput,
} from "./probe-machine"

export function useWslAddServerProbes(input: {
  state: Accessor<WslServersState | undefined>
  api: () => IpcClient<(typeof Wsl)["spec"]>
  /** WSL's main side answers. */
  available: Accessor<boolean>
  view: Accessor<WslAddServerView>
  adding: Accessor<boolean>
  busy: Accessor<boolean>
  selectedDistro: Accessor<string | null>
  addableInstalledDistros: Accessor<WslInstalledDistro[]>
  onError: (cause: unknown) => void
}) {
  // The machine state is immutable; each transition replaces it whole.
  const [probeState, setProbeState] = createSignal(createWslProbeState())
  // Each running probe's abort controller and timeout.
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  // The probe main should run next for what the dialog shows.
  const readInput = (): WslProbeInput => ({
    plan: addServerProbePlan({
      state: input.state(),
      view: input.view(),
      adding: input.adding(),
      busy: input.busy(),
      selectedDistro: input.selectedDistro(),
      addableInstalledDistros: input.addableInstalledDistros(),
    }),
    busy: input.busy(),
    available: input.available(),
  })

  const dispatch = (event: WslProbeEvent) => {
    const previous = untrack(probeState)
    const next = transitionWslProbes(previous, event)

    if (next.state !== previous) setProbeState(next.state)
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(input.onError))
  }

  const run = (effect: WslProbeEffect) => {
    if (effect.type === "probe.error") return input.onError(effect.cause)

    if (effect.type === "probe.abort") {
      const current = runs.get(effect.attempt)

      runs.delete(effect.attempt)
      clearTimeout(current?.timer)
      current?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const controller = new AbortController()

    const settle = (event: (input: WslProbeInput) => WslProbeEvent) => {
      if (runs.has(attempt)) dispatch(event(untrack(readInput)))
    }

    const fail = (cause: unknown) => settle((next) => ({ type: "probe.failed", attempt, cause, ...next }))

    runs.set(attempt, {
      controller,
      timer: setTimeout(() => fail(new Error("WSL probe timed out")), effect.timeoutMs),
    })
    void Promise.try(() => probe(effect.command, controller.signal)).then(
      () => settle((next) => ({ type: "probe.succeeded", attempt, ...next })),
      fail,
    )
  }

  // Asks main to probe; its answer arrives as a new state.
  const probe = (command: AddServerProbePlan, signal: AbortSignal) => {
    const api = input.api()

    if (command.kind === "addable") return api.probeAddable({ distros: command.plan.distros }, { signal })

    if (command.plan.action === "probeRuntime") return api.probeRuntime({ signal })

    return api.refreshDistros({ signal })
  }

  createKeyed(readInput, (next) => dispatch({ type: "synced", ...next }), {
    equals: (previous, next) =>
      previous.plan?.key === next.plan?.key && previous.busy === next.busy && previous.available === next.available,
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    probingAddable: () => selectWslProbingAddable(probeState()),
    /** The user asked to check again: probes that failed may run again. */
    resetProbeFailure: () => dispatch({ type: "reset" }),
  }
}
