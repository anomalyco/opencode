import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createSizing } from "./helpers"
import type { SessionModel } from "./model"
import { room, roomHysteresis, setRoom } from "@/shell/room"
import {
  clampSessionPanelWidth,
  SESSION_PANEL_WIDTH_FIT,
  sessionPanelWidthCss,
  sessionPanelWidthMax,
  SIDE_PANE_DOCK_ROW,
  sideSheetWidth,
} from "./session-panel-width"

/** wide asks for the wider session minimum. */
export function createSessionScreenLayout(session: SessionModel, input: { wide: Accessor<boolean> }) {
  const size = createSizing()
  const view = session.layout.view
  const tabsOpen = createMemo(() => session.isDesktop() && view().side.opened() && !!session.identity.params.id)

  const [rowSize, setRowSize] = createStore<{ width?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width }) => setRowSize({ width }),
  )

  const available = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    return width - 8
  })

  // Asks the open sidebar to give way before the side panel has to float.
  createEffect(() => setRoom("contentMinimum", tabsOpen() ? SIDE_PANE_DOCK_ROW : SESSION_PANEL_WIDTH_FIT))
  onCleanup(() => setRoom("contentMinimum", SESSION_PANEL_WIDTH_FIT))

  // Read from the shell's whole row rather than this one, which moves while the left sidebar does and shrinks when it
  // docks, so the sidebar giving way to the side panel, or docking again as it closes, doesn't float the panel.
  const narrow = createMemo<boolean>((previous) => {
    const width = room.inner ?? rowSize.width

    if (width === undefined) return false

    return width < SIDE_PANE_DOCK_ROW + (previous ? roomHysteresis : 0)
  }, false)

  const sheet = createMemo(() => tabsOpen() && narrow())

  const splitSide = createMemo(() => tabsOpen() && input.wide())

  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: view().session.width(),
      available: available(),
      split: splitSide(),
      resized: view().session.resized(),
    }),
  )

  const panelWidth = createMemo(() => {
    if (!tabsOpen() || sheet()) return "100%"

    return sessionPanelWidthCss({
      width: view().session.width(),
      split: splitSide(),
      resized: view().session.resized(),
    })
  })

  const panelMax = createMemo(() => {
    const width = available()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: splitSide(), resized: true })
  })

  // The side panel's open width, kept through a close as the far end of its travel.
  const sideWidth = createMemo<number | undefined>((previous) => {
    const width = available()

    if (tabsOpen() && width !== undefined)
      return sheet() ? sideSheetWidth(width + 8) : Math.max(0, width - resizedWidth())

    return previous
  })

  const sideContentWidth = createMemo<string>((previous) => {
    const width = sideWidth()

    return width === undefined ? previous : `${width}px`
  }, "100%")

  return {
    centered: createMemo(() => session.isDesktop()),
    panel: {
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable: () => tabsOpen() && !sheet(),
      resizedWidth,
      width: panelWidth,
    },
    side: {
      contentWidth: sideContentWidth,
      width: sideWidth,
      open: tabsOpen,
      /** The open side panel floats over the chat, as the row is too narrow to dock it beside the chat. */
      sheet,
      tabs: { open: tabsOpen },
    },
    size,
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
