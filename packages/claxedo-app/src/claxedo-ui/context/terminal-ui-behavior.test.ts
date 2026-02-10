import { beforeAll, describe, expect, test } from "bun:test"
import { ensureLayoutMocked } from "./_test-helper"

// Dynamic import — must happen after mocks are registered to prevent
// terminal-content-wrapper's transitive import of claxedo-layout from
// caching the real (unmocked) module and poisoning other test files.
let mod: typeof import("../components/terminal-content-wrapper")

beforeAll(async () => {
  await ensureLayoutMocked()
  mod = await import("../components/terminal-content-wrapper")
})

const getEnsureTargets = (...args: Parameters<typeof mod.getEnsureTargets>) => mod.getEnsureTargets(...args)
const nextPortalHost = (...args: Parameters<typeof mod.nextPortalHost>) => mod.nextPortalHost(...args)
const paneInStore = (...args: Parameters<typeof mod.paneInStore>) => mod.paneInStore(...args)
const paneLeafIds = (...args: Parameters<typeof mod.paneLeafIds>) => mod.paneLeafIds(...args)
const pickPendingSplitTarget = (...args: Parameters<typeof mod.pickPendingSplitTarget>) =>
  mod.pickPendingSplitTarget(...args)
const pickVisibleHost = (...args: Parameters<typeof mod.pickVisibleHost>) => mod.pickVisibleHost(...args)
const resolvePortalRender = (...args: Parameters<typeof mod.resolvePortalRender>) =>
  mod.resolvePortalRender(...args)

function host(id: string, style?: Partial<CSSStyleDeclaration>) {
  const elt = document.createElement("div")
  elt.id = id
  if (style?.display) elt.style.display = style.display
  if (style?.visibility) elt.style.visibility = style.visibility
  document.body.appendChild(elt)
  return elt
}

describe("terminal UI behavior helpers", () => {
  test("pickVisibleHost prefers connected visible host over hidden duplicates", () => {
    const hidden = host("claxedo-tab-host-a", { display: "none" })
    const visible = host("claxedo-tab-host-a", { display: "block" })
    const picked = pickVisibleHost([hidden, visible])
    expect(picked).toBe(visible)
    hidden.remove()
    visible.remove()
  })

  test("pickVisibleHost falls back to first candidate when no host is visibly mountable", () => {
    const a = document.createElement("div")
    const b = document.createElement("div")
    const picked = pickVisibleHost([a, b])
    expect(picked).toBe(a)
  })

  test("nextPortalHost rebinds to new mounted host when previous host is disconnected", () => {
    const oldHost = host("claxedo-tab-host-b", { display: "block" })
    oldHost.remove()
    const remounted = host("claxedo-tab-host-b", { display: "block" })
    const next = nextPortalHost(oldHost, [remounted])
    expect(next).toBe(remounted)
    remounted.remove()
  })

  test("nextPortalHost keeps current host when there are no candidates but current is still connected", () => {
    const current = host("claxedo-tab-host-c", { display: "block" })
    const next = nextPortalHost(current, [])
    expect(next).toBe(current)
    current.remove()
  })

  test("nextPortalHost returns null when no candidates and current host is disconnected", () => {
    const current = host("claxedo-tab-host-d", { display: "block" })
    current.remove()
    const next = nextPortalHost(current, [])
    expect(next).toBeNull()
  })

  test("resolvePortalRender gates rendering on both pane root and host", () => {
    const h = host("claxedo-tab-host-e", { display: "block" })
    const pane = { t: "leaf", id: "pty-1" }
    expect(resolvePortalRender(undefined, h)).toBeUndefined()
    expect(resolvePortalRender(pane, null)).toBeUndefined()
    const state = resolvePortalRender(pane, h)
    expect(state).toEqual({ paneRoot: pane, host: h })
    h.remove()
  })

  test("paneLeafIds returns all terminal ids from nested split panes", () => {
    const ids = paneLeafIds({
      t: "split",
      dir: "v",
      size: 0.5,
      a: { t: "leaf", id: "pty-a" },
      b: {
        t: "split",
        dir: "h",
        size: 0.5,
        a: { t: "leaf", id: "pty-b" },
        b: { t: "leaf", id: "pty-c" },
      },
    })
    expect(ids).toEqual(["pty-a", "pty-b", "pty-c"])
  })

  test("paneInStore requires every leaf id to exist in terminal store", () => {
    const pane = {
      t: "split",
      dir: "v",
      size: 0.5,
      a: { t: "leaf", id: "pty-a" },
      b: { t: "leaf", id: "pty-b" },
    } as const
    expect(paneInStore(pane, (id) => id === "pty-a")).toBe(false)
    expect(paneInStore(pane, (id) => id === "pty-a" || id === "pty-b")).toBe(true)
  })

  test("pickPendingSplitTarget finds new pty by id diff, not array position", () => {
    const known = new Set(["pty-a", "pty-b"])
    const target = pickPendingSplitTarget(known, [
      { id: "pty-z" },
      { id: "pty-a" },
      { id: "pty-b" },
    ])
    expect(target?.id).toBe("pty-z")
  })

  test("pickPendingSplitTarget returns undefined when no new pty exists", () => {
    const known = new Set(["pty-a", "pty-b"])
    const target = pickPendingSplitTarget(known, [{ id: "pty-a" }, { id: "pty-b" }])
    expect(target).toBeUndefined()
  })

  test("getEnsureTargets prefers explicit terminalId from tab metadata", () => {
    const targets = getEnsureTargets(
      [{ id: "tab-1", type: "terminal", terminalId: "pty-1" }],
      "tab-1",
      () => undefined,
      () => [],
    )
    expect(targets).toEqual([{ tabId: "tab-1", id: "pty-1" }])
  })

  test("getEnsureTargets falls back to claxedo terminal focus when terminalId is absent", () => {
    const targets = getEnsureTargets(
      [{ id: "tab-2", type: "terminal" }],
      "tab-2",
      (tabId) => (tabId === "tab-2" ? "pty-focus" : undefined),
      () => [],
    )
    expect(targets).toEqual([{ tabId: "tab-2", id: "pty-focus" }])
  })

  test("getEnsureTargets falls back to first pane id when no terminalId and no focus exist", () => {
    const targets = getEnsureTargets(
      [{ id: "tab-3", type: "terminal" }],
      "tab-3",
      () => undefined,
      (tabId) => (tabId === "tab-3" ? ["pty-pane", "pty-other"] : []),
    )
    expect(targets).toEqual([{ tabId: "tab-3", id: "pty-pane" }])
  })

  test("getEnsureTargets ignores non-terminal tabs and unresolved terminal tabs", () => {
    const targets = getEnsureTargets(
      [
        { id: "s-1", type: "session" },
        { id: "t-1", type: "terminal" },
      ],
      undefined,
      () => undefined,
      () => [],
    )
    expect(targets).toEqual([])
  })

  test("getEnsureTargets supports route-level aggregate tab list across groups", () => {
    const targets = getEnsureTargets(
      [
        { id: "g1-tab", type: "terminal", terminalId: "pty-a" },
        { id: "g2-tab", type: "terminal", terminalId: "pty-b" },
      ],
      "g1-tab",
      () => undefined,
      () => [],
    )
    expect(targets.map((x) => x.id).sort()).toEqual(["pty-a", "pty-b"])
  })
})
