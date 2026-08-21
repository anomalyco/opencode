import { createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
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
  const desktopTerminalOpen = createMemo(() => session.isDesktop() && terminalOpen())
  const fileTreeOpen = createMemo(
    () =>
      session.isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )
  const resizable = createMemo(() => reviewPanelOpen() || desktopTerminalOpen())
  const sidePanelOpen = createMemo(() => resizable() || fileTreeOpen())
  const [rowWidth, setRowWidth] = createSignal<number>()
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width }) => setRowWidth(width),
  )
  const available = createMemo<number | undefined>(() => {
    const width = rowWidth()
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
      terminal: desktopTerminalOpen(),
      files: fileTreeOpen(),
    }),
  )
  const [reviewSnap, setReviewSnap] = createSignal(false)
  let reviewFrame: number | undefined
  createComputed((previous) => {
    const open = reviewOpen()
    if (previous === undefined || previous === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setReviewSnap(true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setReviewSnap(false)
    })
    return open
  }, reviewOpen())
  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
  })

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
      snap: reviewSnap,
    },
    side: { layout: panelLayout, open: sidePanelOpen },
    size,
    terminal: {
      desktopOpen: desktopTerminalOpen,
      inlineOnlyOpen: createMemo(() => desktopTerminalOpen() && !reviewPanelOpen()),
      open: terminalOpen,
    },
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
