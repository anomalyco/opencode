import { describe, expect, test } from "bun:test"
import {
  addableProbePlan,
  addServerProbePlan,
  addServerViewModel,
  autoProbePlan,
  createProbeFailureGate,
  runAddableProbePlan,
  wslOpencodeAction,
  wslRuntimeRetryable,
} from "./settings-model"
import type { WslServersState } from "./types"

const readyWslState = readyState()

function readyState(input: Partial<WslServersState> = {}): WslServersState {
  return {
    runtime: { available: true, version: "2.4.13.0", error: null },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    job: null,
    ...input,
  }
}

describe("WSL server settings presentation", () => {
  test("retries only settled unsuccessful runtimes", () => {
    expect(wslRuntimeRetryable({ kind: "starting" })).toBe(false)
    expect(wslRuntimeRetryable({ kind: "ready", url: "http://127.0.0.1:4096", username: null, password: null })).toBe(
      false,
    )
    expect(wslRuntimeRetryable({ kind: "failed", message: "boom" })).toBe(true)
    expect(wslRuntimeRetryable({ kind: "stopped" })).toBe(true)
  })

  test("offers install and update only when OpenCode needs attention", () => {
    expect(wslOpencodeAction(undefined)).toBeUndefined()
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: null,
        version: null,
        expectedVersion: "1.2.3",
        matchesDesktop: null,
        error: null,
      }),
    ).toBe("Install OpenCode")
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: "/usr/local/bin/opencode",
        version: "1.2.2",
        expectedVersion: "1.2.3",
        matchesDesktop: false,
        error: null,
      }),
    ).toBe("Update OpenCode")
    expect(
      wslOpencodeAction({
        distro: "Debian",
        resolvedPath: "/usr/local/bin/opencode",
        version: "1.2.3",
        expectedVersion: "1.2.3",
        matchesDesktop: true,
        error: null,
      }),
    ).toBeUndefined()
  })

  test("plans addable distro probes with the selected distro first", () => {
    const plan = addableProbePlan({
      state: readyWslState,
      view: "main",
      adding: false,
      selectedDistro: "Ubuntu",
      addableInstalledDistros: [
        { name: "Debian", version: 2, isDefault: true },
        { name: "Ubuntu", version: 2, isDefault: false },
      ],
    })

    expect(plan?.key).toBe("distro:Ubuntu|distro:Debian")
    expect(plan?.distros).toEqual(["Ubuntu", "Debian"])
  })

  test("plans bootstrap probes for missing runtime and initial distro lists", () => {
    expect(autoProbePlan({ state: undefined, busy: false })).toBeUndefined()
    expect(autoProbePlan({ state: { ...readyWslState, runtime: null }, busy: false })).toEqual({
      key: "runtime",
      action: "probeRuntime",
    })
    expect(autoProbePlan({ state: readyWslState, busy: false })).toEqual({
      key: "distros",
      action: "refreshDistros",
    })
  })

  test("uses one command plan for bootstrap before addable distro probing", () => {
    expect(
      addServerProbePlan({
        state: { ...readyWslState, runtime: null },
        view: "main",
        adding: false,
        busy: false,
        selectedDistro: null,
        addableInstalledDistros: [{ name: "Debian", version: 2, isDefault: true }],
      }),
    ).toEqual({ kind: "auto", key: "auto:runtime", plan: { key: "runtime", action: "probeRuntime" } })

    expect(
      addServerProbePlan({
        state: {
          ...readyWslState,
          installed: [{ name: "Debian", version: 2, isDefault: true }],
          online: [{ name: "Ubuntu", label: "Ubuntu" }],
        },
        view: "main",
        adding: false,
        busy: false,
        selectedDistro: "Debian",
        addableInstalledDistros: [{ name: "Debian", version: 2, isDefault: true }],
      }),
    ).toEqual({ kind: "addable", key: "addable:distro:Debian", plan: { key: "distro:Debian", distros: ["Debian"] } })
  })

  test("does not accept the same failed probe command until reset", () => {
    const gate = createProbeFailureGate()

    expect(gate.accepts("addable:distro:Debian")).toBe(true)
    gate.settle("addable:distro:Debian", new Error("wsl failed"))
    expect(gate.accepts("addable:distro:Debian")).toBe(false)
    expect(gate.accepts("addable:distro:Ubuntu")).toBe(true)
    gate.reset()
    expect(gate.accepts("addable:distro:Debian")).toBe(true)
  })

  test("keeps default distro selection stable while probes resolve", () => {
    const model = addServerViewModel({
      state: {
        ...readyWslState,
        installed: [
          { name: "Debian", version: 2, isDefault: true },
          { name: "Ubuntu", version: 2, isDefault: false },
        ],
        online: [{ name: "Alpine", label: "Alpine Linux" }],
        distroProbes: {
          Ubuntu: { name: "Ubuntu", canExecute: true, hasBash: true, hasCurl: true, error: null },
        },
      },
      view: "main",
      selectedDistro: null,
      catalogSearch: "",
      catalogTarget: null,
      adding: false,
      probingAddable: false,
    })

    expect(model.selectedDistro).toBe("Debian")
  })

  test("keeps the dialog busy across serial addable probe job gaps", () => {
    const model = addServerViewModel({
      state: readyState({
        installed: [{ name: "Debian", version: 2, isDefault: true }],
        online: [{ name: "Ubuntu", label: "Ubuntu" }],
      }),
      view: "main",
      selectedDistro: null,
      catalogSearch: "",
      catalogTarget: null,
      adding: false,
      probingAddable: true,
    })

    expect(model.busy).toBe(true)
  })

  test("does not report ready when OpenCode is present but cannot run", () => {
    const model = addServerViewModel({
      state: {
        ...readyWslState,
        installed: [{ name: "Debian", version: 2, isDefault: true }],
        online: [{ name: "Ubuntu", label: "Ubuntu" }],
        distroProbes: {
          Debian: { name: "Debian", canExecute: true, hasBash: true, hasCurl: true, error: null },
        },
        opencodeChecks: {
          Debian: {
            distro: "Debian",
            resolvedPath: "/home/me/.opencode/bin/opencode",
            version: null,
            expectedVersion: "1.2.3",
            matchesDesktop: null,
            error: "opencode is installed but could not run",
          },
        },
      },
      view: "main",
      selectedDistro: null,
      catalogSearch: "",
      catalogTarget: null,
      adding: false,
      probingAddable: false,
    })

    expect(model.distroStatuses.Debian).toEqual({
      label: { key: "wsl.onboarding.installOpencode" },
      tone: "warning",
    })
    expect(model.primaryButton.action).toBe("install-opencode")
  })

  test("delegates addable probe plans to one batch command", async () => {
    const calls: string[][] = []

    await runAddableProbePlan({
      plan: { key: "distro:Debian|distro:Ubuntu", distros: ["Debian", "Ubuntu"] },
      api: {
        probeAddable: async (distros) => {
          calls.push(distros)
        },
      },
    })

    expect(calls).toEqual([["Debian", "Ubuntu"]])
  })
})
