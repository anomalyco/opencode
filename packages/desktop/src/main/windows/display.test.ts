import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import type { Rectangle } from "electron"
import { reconcileWindowBounds, wireDisplayRecovery, type WindowDisplaySnapshot } from "./display"

// Exact mixed-DPI geometry from #59229: 200% primary (1560x992 DIP) + 125% upper secondary (2752x1152 DIP).
const primaryWorkArea: Rectangle = { x: 0, y: 0, width: 1560, height: 992 }

const secondaryWorkArea: Rectangle = { x: -102, y: -1152, width: 2752, height: 1152 }

const workAreas = [primaryWorkArea, secondaryWorkArea]

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

  afterEach(() => jest.useRealTimers())

  test("repairs drifted maximized bounds after resume and drops its global listeners on close", () => {
    const display = { workArea: secondaryWorkArea }
    const powerMonitor = new EventEmitter()

    const screen = Object.assign(new EventEmitter(), {
      getAllDisplays: () => [display],
      getDisplayMatching: () => display,
    })

    const applied: Rectangle[] = []
    const captured: (Rectangle | undefined)[] = []
    const state = { bounds: secondaryWorkArea }

    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isMaximized: () => true,
      isFullScreen: () => false,
      getBounds: () => state.bounds,
      getContentBounds: () => state.bounds,
      setBounds: (bounds: Rectangle) => {
        applied.push(bounds)
        state.bounds = bounds
      },
      hookWindowMessage: () => undefined,
      webContents: {
        isDestroyed: () => false,
        invalidate: () => undefined,
        capturePage: (rect?: Rectangle) => {
          captured.push(rect)

          return Promise.resolve()
        },
      },
    })

    wireDisplayRecovery(win, { powerMonitor, screen, updateTitlebar: () => undefined })
    state.bounds = { x: -102, y: -1152, width: 2201, height: 921 }
    powerMonitor.emit("resume")
    jest.advanceTimersByTime(16)

    expect(applied).toEqual([secondaryWorkArea])
    expect(captured).toEqual([{ x: 0, y: 0, width: 1, height: 1 }])

    win.emit("closed")

    expect([...powerMonitor.eventNames(), ...screen.eventNames()]).toEqual([])
  })
})
