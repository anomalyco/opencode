import { createEffect, createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { createSizing } from "./helpers"
import type { SessionModel } from "./model"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "./session-panel-width"

/** wide asks for the wider session minimum; sidebar is whether any extension fills the side panel sidebar. */
export function createSessionScreenLayout(
  session: SessionModel,
  input: { wide: Accessor<boolean>; sidebar: Accessor<boolean> },
) {
  const layout = useLayout()
  const settings = useSettings()
  const size = createSizing()
  const view = session.layout.view
  const tabsOpen = createMemo(() => session.isDesktop() && view().side.opened() && !!session.identity.params.id)
  const dockOpen = createMemo(() => view().dock.opened())
  const dockSide = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "side")
  const dockBottom = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "bottom")
  const dockSideOpen = createMemo(() => dockOpen() && dockSide())

  const fileTreeOpen = createMemo(
    () => session.isDesktop() && input.sidebar() && settings.visibility.fileTree() && layout.fileTree.opened(),
  )

  const resizable = createMemo(() => tabsOpen() || dockSideOpen())
  const besideOpen = createMemo(() => resizable() || fileTreeOpen())
  const [rowSize, setRowSize] = createStore<{ width?: number; height?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width, height }) => setRowSize({ width, height }),
  )

  const available = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    return width - 8
  })

  const splitSide = createMemo(() => tabsOpen() && input.wide())

  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: view().session.width(),
      available: available(),
      split: splitSide(),
    }),
  )

  const panelWidth = createMemo(() => {
    if (!besideOpen()) return "100%"

    if (resizable()) return `${resizedWidth()}px`

    return `calc(100% - ${layout.fileTree.width()}px)`
  })

  const panelMax = createMemo(() => {
    const width = available()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: splitSide() })
  })

  const panelLayout = createMemo(() => ({
    visible: tabsOpen() || dockSideOpen() || fileTreeOpen(),
    stacked: tabsOpen() && dockSideOpen(),
  }))

  const [motion, setMotion] = createStore({ gap: panelLayout().stacked, closing: false })
  createEffect((previous) => {
    const stacked = panelLayout().stacked

    if (previous !== stacked) setMotion({ gap: stacked, closing: !stacked })

    return stacked
  }, panelLayout().stacked)
  const sideRegionOpen = createMemo(() => tabsOpen() || fileTreeOpen())

  const dockRegion = createMemo(() =>
    Math.min(view().dock.height(), typeof window === "undefined" ? 600 : window.innerHeight * 0.6),
  )

  const dockRegionHeight = createMemo(() => `${dockRegion()}px`)
  const sideHeight = createMemo(() => rowSize.height)
  const fullSideHeight = createMemo(() => (sideHeight() === undefined ? "100%" : `${sideHeight()}px`))

  const stackedRegionHeight = createMemo(() => {
    const height = sideHeight()

    if (height === undefined) return `calc(100% - ${dockRegionHeight()} - 8px)`

    return `${Math.max(0, height - dockRegion() - 8)}px`
  })

  const sideContentWidth = createMemo<string>((previous) => {
    const width = available()

    if (resizable() && width !== undefined) return `${Math.max(0, width - resizedWidth())}px`

    if (fileTreeOpen()) return `${layout.fileTree.width()}px`

    return previous
  }, "100%")

  return {
    centered: createMemo(() => session.isDesktop()),
    files: { open: fileTreeOpen },
    panel: {
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable,
      resizedWidth,
      width: panelWidth,
    },
    side: {
      contentWidth: sideContentWidth,
      gap: {
        closing: () => motion.closing,
        height: createMemo(() => (motion.gap ? "8px" : "0px")),
      },
      layout: panelLayout,
      region: {
        height: createMemo(() => {
          if (!sideRegionOpen()) return "0px"

          if (dockSideOpen()) return stackedRegionHeight()

          return fullSideHeight()
        }),
        open: sideRegionOpen,
      },
      tabs: { open: tabsOpen },
      dock: {
        contentHeight: createMemo(() => (sideRegionOpen() ? dockRegionHeight() : fullSideHeight())),
        height: createMemo(() => {
          if (!dockSideOpen()) return "0px"

          if (sideRegionOpen()) return dockRegionHeight()

          return fullSideHeight()
        }),
      },
    },
    size,
    dock: {
      bottom: dockBottom,
      open: dockOpen,
      side: dockSide,
    },
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
