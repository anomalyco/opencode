import type { NativeImage, Rectangle } from "electron"

// Win32 messages that signal monitor topology, DPI, work-area, or session-unlock transitions.
const WM_SETTINGCHANGE = 0x001a

const WM_DISPLAYCHANGE = 0x007e

const WM_DPICHANGED = 0x02e0

const WM_WTSSESSION_CHANGE = 0x02b1

const SPI_SETWORKAREA = 0x002f

const WTS_CONSOLE_CONNECT = 0x1

const WTS_SESSION_UNLOCK = 0x8

// Fractional DPI scales can round frameless client bounds 1-3 DIPs from display.workArea
// (electron#51572); mixed-DPI wake bugs misplace maximized bounds by hundreds of DIPs (#59229).
const MAXIMIZED_ORIGIN_TOLERANCE = 3

const MAXIMIZED_SIZE_TOLERANCE = 6

const MIN_VISIBLE_OVERLAP = 64

export type WindowDisplaySnapshot = {
  readonly bounds: Rectangle
  readonly contentBounds: Rectangle
  readonly workArea: Rectangle
  readonly workAreas: readonly Rectangle[]
  readonly isMaximized: boolean
  readonly isMinimized: boolean
  readonly isFullScreen: boolean
}

export type DisplayRecoveryWindow = {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  isFullScreen(): boolean
  getBounds(): Rectangle
  getContentBounds(): Rectangle
  setBounds(bounds: Rectangle, animate?: boolean): void
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void
  on(event: "restore", listener: () => void): void
  once(event: "closed", listener: () => void): void
  readonly webContents: {
    isDestroyed(): boolean
    invalidate(): void
    capturePage(rect?: Rectangle): Promise<NativeImage | void>
  }
}

export type DisplayRecoveryHost<W extends DisplayRecoveryWindow = DisplayRecoveryWindow> = {
  readonly powerMonitor: {
    on(event: "resume", listener: () => void): void
    on(event: "unlock-screen", listener: () => void): void
    off(event: "resume", listener: () => void): void
    off(event: "unlock-screen", listener: () => void): void
  }
  readonly screen: {
    getAllDisplays(): readonly { readonly workArea: Rectangle }[]
    getDisplayMatching(rect: Rectangle): { readonly workArea: Rectangle }
    on(event: "display-metrics-changed", listener: () => void): void
    on(event: "display-added", listener: () => void): void
    on(event: "display-removed", listener: () => void): void
    off(event: "display-metrics-changed", listener: () => void): void
    off(event: "display-added", listener: () => void): void
    off(event: "display-removed", listener: () => void): void
  }
  readonly updateTitlebar: (win: W) => void
}

type RecoveryTimers = {
  fast?: ReturnType<typeof setTimeout>
  settle?: ReturnType<typeof setTimeout>
}

/**
 * Computes corrective DIP bounds when a display or DPI transition leaves a window out of sync:
 * - On mixed-DPI sleep/wake or cross-monitor moves, Chromium's HWNDMessageHandler::OnWindowPosChanging
 *   skips expected_maximized_bounds when HMONITOR changed (`same_monitor == false`), leaving a maximized
 *   frameless window at logical-as-physical bounds (#59229). Passing `workArea` to `setBounds` re-enters
 *   `OnWindowPosChanging` with `same_monitor == true`, snapping the HWND back to the monitor's maximized
 *   work area without unmaximizing or disturbing `normalBounds`.
 * - For restored windows stranded outside all display work areas (including negative-coordinate monitors),
 *   centers the window onto the matching display's work area.
 */
export function reconcileWindowBounds(snapshot: WindowDisplaySnapshot): Rectangle | undefined {
  if (snapshot.isMinimized || snapshot.isFullScreen) return undefined

  if (snapshot.isMaximized) {
    const drifted =
      Math.abs(snapshot.contentBounds.x - snapshot.workArea.x) > MAXIMIZED_ORIGIN_TOLERANCE ||
      Math.abs(snapshot.contentBounds.y - snapshot.workArea.y) > MAXIMIZED_ORIGIN_TOLERANCE ||
      Math.abs(snapshot.contentBounds.width - snapshot.workArea.width) > MAXIMIZED_SIZE_TOLERANCE ||
      Math.abs(snapshot.contentBounds.height - snapshot.workArea.height) > MAXIMIZED_SIZE_TOLERANCE

    return drifted ? snapshot.workArea : undefined
  }

  if (snapshot.workAreas.some((area) => hasVisibleOverlap(snapshot.bounds, area))) return undefined
  const width = Math.min(snapshot.bounds.width, snapshot.workArea.width)
  const height = Math.min(snapshot.bounds.height, snapshot.workArea.height)

  return {
    x: snapshot.workArea.x + Math.max(0, Math.round((snapshot.workArea.width - width) / 2)),
    y: snapshot.workArea.y + Math.max(0, Math.round((snapshot.workArea.height - height) / 2)),
    width,
    height,
  }
}

export function wireDisplayRecovery<W extends DisplayRecoveryWindow>(win: W, host: DisplayRecoveryHost<W>) {
  const timers: RecoveryTimers = {}

  const syncBounds = () => {
    if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return
    const bounds = win.getBounds()

    const next = reconcileWindowBounds({
      bounds,
      contentBounds: win.getContentBounds(),
      workArea: host.screen.getDisplayMatching(bounds).workArea,
      workAreas: host.screen.getAllDisplays().map((display) => display.workArea),
      isMaximized: win.isMaximized(),
      isMinimized: false,
      isFullScreen: win.isFullScreen(),
    })

    if (next) win.setBounds(next, false)
  }

  const reconcile = () => {
    if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return
    syncBounds()
    host.updateTitlebar(win)

    if (win.webContents.isDestroyed()) return
    win.webContents.invalidate()
    // DirectComposition windows use WS_EX_NOREDIRECTIONBITMAP, so an evicted or dropped DComp surface
    // after lock/unlock or monitor sleep/wake renders transparent while remaining hit-testable (#59229).
    // A 1x1 capture runs RenderWidgetHostViewAura::ShowWithVisibility, refreshing ScreenInfos, reallocating
    // an evicted LocalSurfaceId, and forcing Viz to commit a live frame.
    void win.webContents.capturePage({ x: 0, y: 0, width: 1, height: 1 }).catch(() => undefined)
  }

  const schedule = () => {
    clearTimeout(timers.fast)
    clearTimeout(timers.settle)
    timers.fast = setTimeout(reconcile, 16)
    // DisplayPort and HDMI monitors often finish link training 100-300ms after resume or unlock.
    timers.settle = setTimeout(reconcile, 250)
  }

  const onDisplay = () => schedule()

  syncBounds()

  win.hookWindowMessage(WM_DPICHANGED, schedule)
  win.hookWindowMessage(WM_DISPLAYCHANGE, schedule)
  win.hookWindowMessage(WM_SETTINGCHANGE, (wParam) => {
    if (wParam.length >= 4 && wParam.readUInt32LE(0) === SPI_SETWORKAREA) schedule()
  })
  win.hookWindowMessage(WM_WTSSESSION_CHANGE, (wParam) => {
    if (wParam.length < 4) return
    const code = wParam.readUInt32LE(0)

    if (code === WTS_SESSION_UNLOCK || code === WTS_CONSOLE_CONNECT) schedule()
  })
  win.on("restore", schedule)
  host.powerMonitor.on("resume", schedule)
  host.powerMonitor.on("unlock-screen", schedule)
  host.screen.on("display-metrics-changed", onDisplay)
  host.screen.on("display-added", onDisplay)
  host.screen.on("display-removed", onDisplay)

  win.once("closed", () => {
    clearTimeout(timers.fast)
    clearTimeout(timers.settle)
    host.powerMonitor.off("resume", schedule)
    host.powerMonitor.off("unlock-screen", schedule)
    host.screen.off("display-metrics-changed", onDisplay)
    host.screen.off("display-added", onDisplay)
    host.screen.off("display-removed", onDisplay)
  })
}

function hasVisibleOverlap(bounds: Rectangle, area: Rectangle) {
  const minX = Math.min(MIN_VISIBLE_OVERLAP, bounds.width, area.width)
  const minY = Math.min(MIN_VISIBLE_OVERLAP, bounds.height, area.height)
  const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)

  return overlapX >= minX && overlapY >= minY
}
