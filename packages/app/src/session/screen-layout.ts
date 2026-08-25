import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { createSizing, shouldShowFileTree } from "./helpers"
import type { SessionModel } from "./model"
import { sessionPanelLayout } from "./session-panel-layout"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "./session-panel-width"

export function createSessionScreenLayout(session: SessionModel, serverScope: string) {
  const layout = useLayout()
  const settings = useSettings()
  const size = createSizing()
  const reviewOpen = createMemo(() => session.isDesktop() && session.layout.view().reviewPanel.opened())
  const reviewPanelOpen = createMemo(() => reviewOpen() && !!session.identity.params.id)
  const terminalOpen = createMemo(() => session.layout.view().terminal.opened())
  const sideTerminal = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "side")
  const bottomTerminal = createMemo(() => session.isDesktop() && settings.general.terminalPlacement() === "bottom")
  const sideTerminalOpen = createMemo(() => terminalOpen() && sideTerminal())
  const fileTreeOpen = createMemo(
    () =>
      session.isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )
  const resizable = createMemo(() => reviewPanelOpen() || sideTerminalOpen())
  const sidePanelOpen = createMemo(() => resizable() || fileTreeOpen())
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
  const splitReview = createMemo(() => reviewPanelOpen() && layout.review.diffStyle() === "split")
  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: layout.session.width(),
      available: available(),
      split: splitReview(),
    }),
  )
  const panelWidth = createMemo(() => {
    if (!sidePanelOpen()) return "100%"
    if (resizable()) return `${resizedWidth()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const panelMax = createMemo(() => {
    const width = available()
    if (width === undefined) return 1000
    return sessionPanelWidthMax({ available: width, split: splitReview() })
  })
  const panelLayout = createMemo(() =>
    sessionPanelLayout({
      review: reviewPanelOpen(),
      terminal: sideTerminalOpen(),
      files: fileTreeOpen(),
    }),
  )
  const [motion, setMotion] = createStore({ gap: panelLayout().stacked, closing: false })
  createEffect((previous) => {
    const stacked = panelLayout().stacked
    if (previous !== stacked) setMotion({ gap: stacked, closing: !stacked })
    return stacked
  }, panelLayout().stacked)
  const sideRegionOpen = createMemo(() => reviewPanelOpen() || fileTreeOpen())
  const terminalPane = createMemo(() =>
    Math.min(layout.terminal.height(), typeof window === "undefined" ? 600 : window.innerHeight * 0.6),
  )
  const terminalPaneHeight = createMemo(() => `${terminalPane()}px`)
  const sideHeight = createMemo(() => rowSize.height)
  const fullSideHeight = createMemo(() => (sideHeight() === undefined ? "100%" : `${sideHeight()}px`))
  const stackedReviewHeight = createMemo(() => {
    const height = sideHeight()
    if (height === undefined) return `calc(100% - ${terminalPaneHeight()} - 8px)`
    return `${Math.max(0, height - terminalPane() - 8)}px`
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
      key: createMemo(() => (session.identity.params.id ? `${serverScope}\0${session.identity.params.id}` : undefined)),
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable,
      resizedWidth,
      width: panelWidth,
    },
    review: {
      open: reviewOpen,
      panelOpen: reviewPanelOpen,
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
          if (sideTerminalOpen()) return stackedReviewHeight()
          return fullSideHeight()
        }),
        open: sideRegionOpen,
      },
      terminal: {
        contentHeight: createMemo(() => (sideRegionOpen() ? terminalPaneHeight() : fullSideHeight())),
        height: createMemo(() => {
          if (!sideTerminalOpen()) return "0px"
          if (sideRegionOpen()) return terminalPaneHeight()
          return fullSideHeight()
        }),
      },
    },
    size,
    terminal: {
      bottom: bottomTerminal,
      open: terminalOpen,
      side: sideTerminal,
    },
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
