import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WslServersState } from "./contract"
import {
  createWslDialogState,
  transitionWslDialog,
  WSL_ACTION_TIMEOUT_MS,
  WSL_INSTALL_TIMEOUT_MS,
  type WslDialogEffect,
  type WslDialogEvent,
  type WslDialogState,
} from "./dialog-machine"
import { addServerProbePlan, addServerViewModel } from "./model"

// Main's state reaches the window through the Ipc, which decodes it.
function wsl(fields: Partial<typeof WslServersState.Encoded>) {
  return Schema.decodeUnknownSync(WslServersState)({
    runtime: { available: true, version: "2.0", error: null },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    hostJob: "idle",
    distroJobs: {},
    ...fields,
  })
}

const probe = (name: string) => ({ name, canExecute: true, hasBash: true, hasCurl: true, error: null })

const check = (distro: string, version: string | null) => ({
  distro,
  resolvedPath: "/usr/bin/opencode",
  version,
  expectedVersion: "1.0",
  matchesDesktop: version === "1.0",
  error: null,
})

const distros = {
  installed: [
    { name: "Ubuntu", version: 2, isDefault: true },
    { name: "Debian", version: 2, isDefault: false },
  ],
  online: [
    { name: "Fedora", label: "Fedora Linux" },
    { name: "Arch", label: "Arch Linux" },
  ],
}

// Ubuntu is ready to add; Debian needs OpenCode; Fedora can be installed from the catalog. Main runs no job.
const idle = wsl({
  ...distros,
  distroProbes: { Ubuntu: probe("Ubuntu"), Debian: probe("Debian") },
  opencodeChecks: { Ubuntu: check("Ubuntu", "1.0"), Debian: check("Debian", "0.9") },
})

// The same distros before any probe, so the main view wants to probe them.
const unprobed = wsl(distros)

const view = (dialog: WslDialogState) => addServerViewModel({ state: idle, dialog, probingAddable: false })

// The probe the dialog would start now, planned as the dialog plans it.
const plan = (dialog: WslDialogState) => {
  const model = view(dialog)

  return addServerProbePlan({
    state: unprobed,
    view: model.view,
    busy: model.busy,
    selectedDistro: model.selectedDistro,
    addableInstalledDistros: model.addableInstalledDistros,
  })
}

function replay(state: WslDialogState, events: readonly WslDialogEvent[]) {
  return events.reduce<{ state: WslDialogState; effects: readonly WslDialogEffect[] }>(
    (result, event) => {
      const next = transitionWslDialog(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const catalog = replay(createWslDialogState(), [{ type: "catalog.opened", defaultTarget: "Fedora", busy: false }]).state

// The main view with `distro` picked.
const picked = (distro: string) =>
  transitionWslDialog(createWslDialogState(), { type: "distro.selected", distro }).state

// A click on the primary button with `distro` picked, as the dialog reads the button.
const primary = (distro: string): WslDialogEvent => {
  const button = view(picked(distro)).primaryButton

  return { type: "primary.requested", distro, action: button.action, disabled: button.disabled || button.loading }
}

describe("wsl add-server dialog", () => {
  test("installing a distro claims the catalog before main's state shows the job", () => {
    const installing = transitionWslDialog(catalog, {
      type: "catalog.install.requested",
      distro: "Fedora",
      busy: false,
    })

    expect(installing.state).toMatchObject({ status: "catalog-installing", attempt: 1, distro: "Fedora" })
    expect(installing.effects).toEqual([
      { type: "probes.reset" },
      {
        type: "action.run",
        attempt: 1,
        action: { kind: "install-distro", distro: "Fedora" },
        timeoutMs: WSL_INSTALL_TIMEOUT_MS,
      },
    ])
    // Main still reports no job, yet the dialog is busy and no probe starts beside the install.
    expect(view(installing.state)).toMatchObject({ busy: true, installingCatalogDistro: true, view: "catalog" })
    expect(plan(catalog)).toBeUndefined()
    expect(plan(transitionWslDialog(catalog, { type: "catalog.closed", busy: false }).state)).toBeDefined()
    expect(plan(installing.state)).toBeUndefined()

    // Cancel, another distro and a second install all wait for the first.
    ;(
      [
        { type: "catalog.closed", busy: false },
        { type: "catalog.target.changed", distro: "Arch" },
        { type: "catalog.install.requested", distro: "Arch", busy: false },
      ] as const
    ).forEach((event) => {
      expect(transitionWslDialog(installing.state, event)).toEqual({ state: installing.state, effects: [] })
    })
  })

  test("each action in the main view claims the dialog before its call leaves", () => {
    const main = createWslDialogState()
    const opencode = transitionWslDialog(picked("Debian"), primary("Debian"))
    const add = transitionWslDialog(main, primary("Ubuntu"))
    const refresh = transitionWslDialog(main, { type: "distros.refresh.requested", busy: false })
    const install = transitionWslDialog(main, { type: "wsl.install.requested", busy: false })

    expect(opencode.effects).toEqual([
      {
        type: "action.run",
        attempt: 1,
        action: { kind: "install-opencode", distro: "Debian" },
        timeoutMs: WSL_INSTALL_TIMEOUT_MS,
      },
    ])
    expect(add.effects).toEqual([
      {
        type: "action.run",
        attempt: 1,
        action: { kind: "add-server", distro: "Ubuntu" },
        timeoutMs: WSL_ACTION_TIMEOUT_MS,
      },
    ])
    expect(refresh.effects).toEqual([
      { type: "probes.reset" },
      { type: "action.run", attempt: 1, action: { kind: "refresh-distros" }, timeoutMs: WSL_ACTION_TIMEOUT_MS },
    ])
    expect(install.effects).toEqual([
      { type: "action.run", attempt: 1, action: { kind: "install-wsl" }, timeoutMs: WSL_INSTALL_TIMEOUT_MS },
    ])

    // Install OpenCode spins at once; before, it waited for main's "updating" with every control still enabled.
    expect(view(opencode.state).primaryButton).toMatchObject({
      action: "install-opencode",
      loading: true,
    })
    expect(view(add.state)).toMatchObject({ adding: true, primaryButton: { action: "add", loading: true } })
    ;[opencode, add, refresh, install].forEach((running) => {
      expect(running.state.status).toBe("main-running")
      expect(view(running.state).busy).toBe(true)
      ;(
        [
          primary("Ubuntu"),
          { type: "distro.selected", distro: "Debian" },
          { type: "catalog.opened", defaultTarget: "Fedora", busy: false },
          { type: "distros.refresh.requested", busy: false },
        ] satisfies WslDialogEvent[]
      ).forEach((event) => {
        expect(transitionWslDialog(running.state, event).state).toBe(running.state)
      })
    })

    // Busy guards follow main's jobs and probes too.
    expect(transitionWslDialog(main, { type: "wsl.install.requested", busy: true }).state).toBe(main)
    expect(
      transitionWslDialog(main, { type: "primary.requested", distro: "Ubuntu", action: "add", disabled: true }).state,
    ).toBe(main)
  })

  test("an add that never answers ends at its timeout, or when main goes away, so Cancel works again", () => {
    const adding = transitionWslDialog(createWslDialogState(), primary("Ubuntu")).state

    expect(view(adding).adding).toBe(true)

    const timedOut = transitionWslDialog(adding, { type: "action.failed", attempt: 1 })

    expect(timedOut.state).toEqual({ status: "main", issued: 1, selectedDistro: null })
    expect(timedOut.effects).toEqual([
      { type: "action.abort", attempt: 1 },
      { type: "toast.error", cause: undefined },
    ])
    expect(view(timedOut.state)).toMatchObject({ adding: false, busy: false })

    const gone = transitionWslDialog(adding, { type: "availability.changed", available: false })

    expect(gone.state).toEqual({ status: "main", issued: 1, selectedDistro: null })
    expect(gone.effects).toEqual([{ type: "action.abort", attempt: 1 }])
    expect(view(gone.state).adding).toBe(false)
    // The aborted call rejects later; nothing more happens.
    expect(transitionWslDialog(gone.state, { type: "action.failed", attempt: 1, cause: "aborted" }).state).toBe(
      gone.state,
    )
    expect(transitionWslDialog(adding, { type: "availability.changed", available: true }).state).toBe(adding)
  })

  test("a call that settles after the dialog closed or moved on changes nothing", () => {
    const installing = transitionWslDialog(catalog, {
      type: "catalog.install.requested",
      distro: "Fedora",
      busy: false,
    }).state

    const adding = transitionWslDialog(createWslDialogState(), primary("Ubuntu")).state

    ;[installing, adding].forEach((running) => {
      const disposed = transitionWslDialog(running, { type: "disposed" })

      expect(disposed.effects).toEqual([{ type: "action.abort", attempt: 1 }])
      ;(
        [
          { type: "action.succeeded", attempt: 1 },
          { type: "action.failed", attempt: 1, cause: new Error("unavailable") },
        ] as const
      ).forEach((event) => {
        expect(transitionWslDialog(disposed.state, event)).toEqual({ state: disposed.state, effects: [] })
      })

      // An answer for another attempt is ignored too.
      expect(transitionWslDialog(running, { type: "action.succeeded", attempt: 7 }).state).toBe(running)
      expect(transitionWslDialog(running, { type: "action.failed", attempt: 7 }).state).toBe(running)
    })

    // A late answer for an install that already ended never pulls the user out of the catalog they reopened.
    const reopened = replay(installing, [
      { type: "action.failed", attempt: 1, cause: new Error("busy") },
      { type: "catalog.closed", busy: false },
      { type: "catalog.opened", defaultTarget: "Arch", busy: false },
    ]).state

    expect(transitionWslDialog(reopened, { type: "action.succeeded", attempt: 1 }).state).toBe(reopened)
  })

  test("each call ends in its own view", () => {
    const searched = replay(catalog, [
      { type: "catalog.search.changed", value: "arch" },
      { type: "catalog.target.changed", distro: "Arch" },
    ]).state

    const installing = transitionWslDialog(searched, { type: "catalog.install.requested", distro: "Arch", busy: false })

    expect(transitionWslDialog(installing.state, { type: "action.succeeded", attempt: 1 })).toEqual({
      state: { status: "main", issued: 1, selectedDistro: null },
      effects: [{ type: "action.abort", attempt: 1 }],
    })
    // A failed install stays in the catalog with what the user searched and picked.
    const cause = new Error("download failed")

    expect(transitionWslDialog(installing.state, { type: "action.failed", attempt: 1, cause })).toEqual({
      state: { status: "catalog", issued: 1, selectedDistro: null, catalogSearch: "arch", catalogTarget: "Arch" },
      effects: [
        { type: "action.abort", attempt: 1 },
        { type: "toast.error", cause },
      ],
    })

    const selected = transitionWslDialog(createWslDialogState(), { type: "distro.selected", distro: "Ubuntu" }).state
    const added = replay(selected, [primary("Ubuntu"), { type: "action.succeeded", attempt: 1 }])

    expect(added.state).toEqual({ status: "completed", selectedDistro: "Ubuntu" })
    expect(added.effects.slice(-2)).toEqual([{ type: "action.abort", attempt: 1 }, { type: "dialog.close" }])
    // The dialog stays busy while it closes.
    expect(view(added.state)).toMatchObject({ adding: true, busy: true })
    expect(transitionWslDialog(added.state, { type: "distro.selected", distro: "Debian" }).state).toBe(added.state)

    const refreshed = replay(createWslDialogState(), [
      { type: "distros.refresh.requested", busy: false },
      { type: "action.succeeded", attempt: 1 },
    ])

    expect(refreshed.state).toEqual({ status: "main", issued: 1, selectedDistro: null })
  })
})
