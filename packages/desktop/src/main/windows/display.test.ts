import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import type { Rectangle } from "electron"
import {
  reconcileWindowBounds,
  wireDisplayRecovery,
  type DisplayRecoveryWindow,
  type WindowDisplaySnapshot,
} from "./display"

// Exact mixed-DPI geometry from #59229: 200% primary (1560x992 DIP) + 125% upper secondary (2752x1152 DIP).
const primaryWorkArea: Rectangle = { x: 0, y: 0, width: 1560, height: 992 }

const secondaryWorkArea: Rectangle = { x: -102, y: -1152, width: 2752, height: 1152 }

const workAreas = [primaryWorkArea, secondaryWorkArea]

type RecordedCalls = {
  setBounds: Rectangle[]
  titlebar: number
  invalidate: number
  capture: (Rectangle | undefined)[]
}

describe("reconcileWindowBounds", () => {
  const cases: readonly {
    readonly name: string
    readonly snapshot: WindowDisplaySnapshot
    readonly expected: Rectangle | undefined
  }[] = [
    {
      name: "repairs a maximized window stuck at cross-DPI virtualized bounds on a negative-Y secondary display (#59229)",
      snapshot: {
        bounds: { x: -112, y: -1162, width: 2218, height: 938 },
        contentBounds: { x: -102, y: -1152, width: 2201, height: 921 },
        workArea: secondaryWorkArea,
        workAreas,
        isMaximized: true,
        isMinimized: false,
        isFullScreen: false,
      },
      expected: secondaryWorkArea,
    },
    {
      name: "leaves a maximized window within fractional-DPI rounding tolerance untouched",
      snapshot: {
        bounds: { x: -110, y: -1160, width: 2768, height: 1168 },
        contentBounds: { x: -101, y: -1151, width: 2754, height: 1153 },
        workArea: secondaryWorkArea,
        workAreas,
        isMaximized: true,
        isMinimized: false,
        isFullScreen: false,
      },
      expected: undefined,
    },
    {
      name: "leaves a restored window on a negative-coordinate secondary display untouched",
      snapshot: {
        bounds: { x: -90, y: -1080, width: 1280, height: 800 },
        contentBounds: { x: -90, y: -1080, width: 1280, height: 800 },
        workArea: secondaryWorkArea,
        workAreas,
        isMaximized: false,
        isMinimized: false,
        isFullScreen: false,
      },
      expected: undefined,
    },
    {
      name: "centers a restored window stranded completely outside all work areas after display removal",
      snapshot: {
        bounds: { x: -4200, y: -2400, width: 1280, height: 800 },
        contentBounds: { x: -4200, y: -2400, width: 1280, height: 800 },
        workArea: primaryWorkArea,
        workAreas: [primaryWorkArea],
        isMaximized: false,
        isMinimized: false,
        isFullScreen: false,
      },
      expected: { x: 140, y: 96, width: 1280, height: 800 },
    },
    {
      name: "ignores minimized and fullscreen windows",
      snapshot: {
        bounds: { x: -32000, y: -32000, width: 160, height: 28 },
        contentBounds: { x: -32000, y: -32000, width: 160, height: 28 },
        workArea: primaryWorkArea,
        workAreas,
        isMaximized: true,
        isMinimized: true,
        isFullScreen: false,
      },
      expected: undefined,
    },
  ]

  test.each(cases)("$name", ({ snapshot, expected }) => {
    expect(reconcileWindowBounds(snapshot)).toEqual(expected)
  })
})

describe("wireDisplayRecovery", () => {
  beforeEach(() => jest.useFakeTimers())

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  function createHarness(initialContent: Rectangle = secondaryWorkArea) {
    const messages = new Map<number, (wParam: Buffer, lParam: Buffer) => void>()
    const winEvents = new Map<string, Set<() => void>>()
    const powerEvents = new Map<string, Set<() => void>>()
    const screenEvents = new Map<string, Set<() => void>>()

    const calls: RecordedCalls = {
      setBounds: [],
      titlebar: 0,
      invalidate: 0,
      capture: [],
    }

    const state = {
      destroyed: false,
      visible: true,
      minimized: false,
      maximized: true,
      fullScreen: false,
      bounds: { x: -112, y: -1162, width: 2218, height: 938 },
      contentBounds: initialContent,
    }

    const add = (map: Map<string, Set<() => void>>, event: string, fn: () => void) => {
      const set = map.get(event) ?? new Set()
      set.add(fn)
      map.set(event, set)
    }

    const remove = (map: Map<string, Set<() => void>>, event: string, fn: () => void) => {
      map.get(event)?.delete(fn)
    }

    const emit = (map: Map<string, Set<() => void>>, event: string) => {
      for (const fn of [...(map.get(event) ?? [])]) fn()
    }

    const win: DisplayRecoveryWindow = {
      isDestroyed: () => state.destroyed,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isMaximized: () => state.maximized,
      isFullScreen: () => state.fullScreen,
      getBounds: () => state.bounds,
      getContentBounds: () => state.contentBounds,
      setBounds: (rect) => {
        calls.setBounds.push(rect)
        state.contentBounds = rect
      },
      hookWindowMessage: (msg, cb) => {
        messages.set(msg, cb)
      },
      on: (event, fn) => {
        add(winEvents, event, fn)
      },
      once: (event, fn) => {
        const onceFn = () => {
          remove(winEvents, event, onceFn)
          fn()
        }

        add(winEvents, event, onceFn)
      },
      webContents: {
        isDestroyed: () => state.destroyed,
        invalidate: () => {
          calls.invalidate++
        },
        capturePage: (rect) => {
          calls.capture.push(rect)

          return Promise.resolve(undefined)
        },
      },
    }

    const secondaryDisplay = { workArea: secondaryWorkArea }

    wireDisplayRecovery(win, {
      powerMonitor: {
        on: (event, fn) => {
          add(powerEvents, event, fn)
        },
        off: (event, fn) => {
          remove(powerEvents, event, fn)
        },
      },
      screen: {
        getAllDisplays: () => [secondaryDisplay],
        getDisplayMatching: () => secondaryDisplay,
        on: (event, fn) => {
          add(screenEvents, event, fn)
        },
        off: (event, fn) => {
          remove(screenEvents, event, fn)
        },
      },
      updateTitlebar: () => {
        calls.titlebar++
      },
    })

    const wParam = (value: number) => {
      const buf = Buffer.alloc(4)
      buf.writeUInt32LE(value, 0)

      return buf
    }

    return {
      state,
      calls,
      powerEvents,
      screenEvents,
      sendWinMessage: (msg: number, param = 0) => messages.get(msg)?.(wParam(param), Buffer.alloc(0)),
      emitPower: (event: string) => emit(powerEvents, event),
      emitScreen: (event: string) => emit(screenEvents, event),
      emitWin: (event: string) => emit(winEvents, event),
    }
  }

  test.each([
    ["WM_DPICHANGED", (h: ReturnType<typeof createHarness>) => h.sendWinMessage(0x02e0)],
    ["WM_DISPLAYCHANGE", (h: ReturnType<typeof createHarness>) => h.sendWinMessage(0x007e)],
    ["WM_SETTINGCHANGE(SPI_SETWORKAREA)", (h: ReturnType<typeof createHarness>) => h.sendWinMessage(0x001a, 0x002f)],
    [
      "WM_WTSSESSION_CHANGE(WTS_SESSION_UNLOCK)",
      (h: ReturnType<typeof createHarness>) => h.sendWinMessage(0x02b1, 0x8),
    ],
    ["powerMonitor resume", (h: ReturnType<typeof createHarness>) => h.emitPower("resume")],
    ["powerMonitor unlock-screen", (h: ReturnType<typeof createHarness>) => h.emitPower("unlock-screen")],
    [
      "screen display-metrics-changed",
      (h: ReturnType<typeof createHarness>) => h.emitScreen("display-metrics-changed"),
    ],
  ] as const)("repairs drifted maximized bounds and refreshes the compositor surface on %s", (_label, trigger) => {
    const h = createHarness()
    h.state.contentBounds = { x: -102, y: -1152, width: 2201, height: 921 }

    trigger(h)
    jest.advanceTimersToNextTimer()
    expect(h.calls.setBounds).toEqual([secondaryWorkArea])
    expect(h.calls.titlebar).toBe(1)
    expect(h.calls.invalidate).toBe(1)
    expect(h.calls.capture).toEqual([{ x: 0, y: 0, width: 1, height: 1 }])

    // Settle pass re-verifies after DisplayPort link training without re-setting already-aligned bounds.
    jest.advanceTimersToNextTimer()
    expect(h.calls.setBounds).toEqual([secondaryWorkArea])
    expect(h.calls.titlebar).toBe(2)
    expect(h.calls.capture).toHaveLength(2)
  })

  test("ignores non-unlock session messages and cleans up all global listeners on close", () => {
    const h = createHarness()
    // WTS_SESSION_LOCK (0x7) must not wake the compositor while the workstation is locked.
    h.sendWinMessage(0x02b1, 0x7)
    jest.runOnlyPendingTimers()
    expect(h.calls.invalidate).toBe(0)

    h.emitPower("resume")
    h.state.destroyed = true
    h.emitWin("closed")
    jest.runOnlyPendingTimers()
    expect(h.calls.invalidate).toBe(0)
    expect(h.powerEvents.get("resume")?.size ?? 0).toBe(0)
    expect(h.powerEvents.get("unlock-screen")?.size ?? 0).toBe(0)
    expect(h.screenEvents.get("display-metrics-changed")?.size ?? 0).toBe(0)
    expect(h.screenEvents.get("display-added")?.size ?? 0).toBe(0)
    expect(h.screenEvents.get("display-removed")?.size ?? 0).toBe(0)
  })
})
