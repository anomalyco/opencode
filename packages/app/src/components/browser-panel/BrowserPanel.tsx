/** @jsxImportSource solid-js */
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useAnnotationStore } from "@/context/annotation-store"
import { openBrowserPanel } from "@/context/browser-actions"
import { getNextBrowserIdAfterClose, useBrowserStore } from "@/context/browser-store"
import type { BrowserAnnotationDetail, BrowserConsoleEntry, BrowserInspectResult } from "@/context/browser-types"
import { usePrompt, type ImageAttachmentPart } from "@/context/prompt"
import { BrowserPanelTabs } from "./BrowserPanelTabs"
import { BrowserPanelToolbar } from "./BrowserPanelToolbar"
import "./BrowserPanel.css"

type BrowserPanelController = {
  opened: () => boolean
  open: () => void
  close: () => void
}

export function getBrowserPanelBounds(bounds: Pick<DOMRect, "height" | "left" | "top" | "width">) {
  return {
    x: Math.max(0, Math.round(bounds.left)),
    y: Math.max(0, Math.round(bounds.top)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

export function applyInspectResult(
  annotations: Pick<ReturnType<typeof useAnnotationStore>, "addAnnotationFromInspectResult">,
  result: BrowserInspectResult | null,
) {
  if (!result) return false
  annotations.addAnnotationFromInspectResult(result)
  return true
}

function formatConsoleTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp))
}

function formatConsoleSource(entry: BrowserConsoleEntry) {
  if (!entry.source) return entry.line === null ? "" : `line ${entry.line}`
  if (entry.line === null) return entry.source
  return `${entry.source}:${entry.line}`
}

export function BrowserPanel(props: { panel?: BrowserPanelController } = {}) {
  const annotations = useAnnotationStore()
  const browsers = useBrowserStore()
  const prompt = usePrompt()
  const dialog = useDialog()
  const browser = () => window.api?.browser
  const panelOpen = () => props.panel?.opened() ?? annotations.store.panelOpen
  const browserBlocked = () => !!dialog.active
  const activeBrowserId = () => browsers.store.activeId ?? undefined
  const browserTabs = () => {
    const tabs = Object.values(browsers.store.instances ?? {})
    if (tabs.length > 0) return tabs
    return [{ id: "default", title: state.currentUrl, url: state.currentUrl, visible: true }]
  }
  const selectedTabId = () => browsers.store.activeId ?? browserTabs()[0]?.id ?? null
  const [state, setState] = createStore({
    available: !!browser(),
    canGoBack: false,
    canGoForward: false,
    currentUrl: "",
    draftUrl: "",
    annotationDraft: "",
    annotationRevision: 0,
    isLoading: false,
    selectionPending: false,
    screenshotCaptured: false,
    view: "page" as "page" | "console",
  })
  let view: HTMLDivElement | undefined
  let pageSwitchButton: HTMLButtonElement | undefined
  let consoleSwitchButton: HTMLButtonElement | undefined
  let screenshotButton: HTMLButtonElement | undefined
  let annotationButton: HTMLButtonElement | undefined
  let annotationOverlay: HTMLDivElement | undefined
  let annotationEditor: HTMLDivElement | undefined
  let annotationInput: HTMLTextAreaElement | undefined
  let consoleCount: HTMLSpanElement | undefined
  let consoleContent: HTMLDivElement | undefined
  let annotationCount: HTMLDivElement | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let screenshotFeedbackTimer: ReturnType<typeof setTimeout> | undefined
  let browserVisible = false
  let visibleBrowserId: string | undefined
  let activatedBrowserId: string | undefined
  let activatingBrowserId: string | undefined
  let activationPromise: Promise<void> | undefined
  let closeSelectionOverride: string | undefined
  let closeTabInProgress = false
  let syncRequest = 0
  let consoleRequest = 0
  let inspectRequest = 0

  const runSafely = (promise: Promise<unknown>) => {
    void promise.catch(() => undefined)
  }

  const annotationItems = () => {
    state.annotationRevision
    return annotations.store.annotations
  }

  const pendingAnnotation = () => {
    state.annotationRevision
    return annotations.store.pendingAnnotation
  }

  const appendConsoleCell = (row: HTMLDivElement, className: string, text: string) => {
    const cell = document.createElement("span")
    cell.className = className
    cell.textContent = text
    row.append(cell)
  }

  const renderConsoleMessages = (entries: BrowserConsoleEntry[]) => {
    if (consoleCount) consoleCount.textContent = `${entries.length} messages`
    if (!consoleContent) return
    consoleContent.replaceChildren()
    if (entries.length === 0) {
      const empty = document.createElement("div")
      empty.className = "browser-console-empty"
      empty.textContent = "No console messages yet."
      consoleContent.append(empty)
      return
    }

    const list = document.createElement("div")
    list.className = "browser-console-list"
    list.setAttribute("role", "log")
    list.setAttribute("aria-label", "Browser console messages")
    entries.map((entry) => {
      const row = document.createElement("div")
      row.className = "browser-console-row"
      appendConsoleCell(row, "browser-console-level", entry.level)
      appendConsoleCell(row, "browser-console-message", entry.message)
      appendConsoleCell(row, "browser-console-source", formatConsoleSource(entry))
      appendConsoleCell(row, "browser-console-time", formatConsoleTime(entry.timestamp))
      if (entry.truncated) appendConsoleCell(row, "browser-console-truncated", "truncated")
      list.append(row)
    })
    consoleContent.append(list)
  }

  const renderAnnotationMarkers = () => {
    const overlay = annotationOverlay
    if (!overlay) return
    overlay.replaceChildren()
    annotationItems().map((annotation, index) => {
      const marker = document.createElement("div")
      marker.className = "browser-annotation-marker"
      marker.textContent = `${index + 1}`
      marker.setAttribute("aria-label", `Annotation ${index + 1}`)
      marker.style.left = `${annotation.element.boundingBox.x}px`
      marker.style.top = `${annotation.element.boundingBox.y}px`
      overlay.append(marker)
    })
  }

  const pendingAnnotationPosition = () => {
    const pending = pendingAnnotation()
    if (!pending) return { left: "12px", top: "12px" }
    return {
      left: `${pending.element.boundingBox.x + pending.element.boundingBox.width + 8}px`,
      top: `${pending.element.boundingBox.y}px`,
    }
  }

  const submitPendingAnnotation = () => {
    const id = annotations.confirmPendingAnnotation(state.annotationDraft)
    if (!id) return
    annotationEditor?.remove()
    annotationEditor = undefined
    setState("annotationDraft", "")
    setState("annotationRevision", state.annotationRevision + 1)
  }

  const cancelPendingAnnotation = () => {
    annotations.cancelPendingAnnotation()
    annotationEditor?.remove()
    annotationEditor = undefined
    setState("annotationDraft", "")
    setState("annotationRevision", state.annotationRevision + 1)
  }

  const updateAnnotationCount = () => {
    const count = annotationItems().length
    if (!annotationCount) return
    annotationCount.textContent = count === 0 ? "No annotations" : count === 1 ? "1 annotation" : `${count} annotations`
  }

  const annotationEditorKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      cancelPendingAnnotation()
      return
    }
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    submitPendingAnnotation()
  }

  const ensureActiveBrowser = async (api: NonNullable<ReturnType<typeof browser>>, browserId: string | undefined) => {
    if (!browserId || !api.setActiveBrowser) return true
    if (activatedBrowserId === browserId) return true
    if (activatingBrowserId !== browserId) {
      activatingBrowserId = browserId
      activationPromise = api
        .setActiveBrowser(browserId)
        .then(() => {
          if (activatingBrowserId === browserId) activatedBrowserId = browserId
        })
        .finally(() => {
          if (activatingBrowserId !== browserId) return
          activatingBrowserId = undefined
          activationPromise = undefined
        })
    }
    await activationPromise
    return activatedBrowserId === browserId
  }

  const showBrowser = () => {
    const api = browser()
    const browserId = activeBrowserId()
    if (!api || (browserVisible && visibleBrowserId === browserId)) return
    api.attach(browserId)
    api.show(browserId)
    browserVisible = true
    visibleBrowserId = browserId
  }

  const hideBrowser = () => {
    const api = browser()
    if (!api) return
    api.hide(visibleBrowserId ?? activeBrowserId())
    browserVisible = false
    visibleBrowserId = undefined
  }

  const syncBounds = () => {
    const api = browser()
    const browserId = activeBrowserId()
    if (!api || !panelOpen() || browserBlocked() || state.view !== "page" || !view) return
    if (browserId && api.setActiveBrowser && activatedBrowserId !== browserId) return

    const bounds = view.getBoundingClientRect()
    api.setBounds(getBrowserPanelBounds(bounds), browserId)
  }

  const activateAndSyncBrowser = async () => {
    const api = browser()
    const browserId = activeBrowserId()
    const request = ++syncRequest
    if (!api || !panelOpen()) return
    if (browserBlocked()) return
    if (closeTabInProgress) return
    if (closeSelectionOverride && browserId !== closeSelectionOverride) return
    if (!(await ensureActiveBrowser(api, browserId))) return
    if (request !== syncRequest || !panelOpen() || activeBrowserId() !== browserId) return
    showBrowser()
    syncBounds()
    if (closeSelectionOverride === browserId) closeSelectionOverride = undefined
  }

  const syncState = async () => {
    const api = browser()
    if (!api) return
    const next = await api.getState()
    const draftUrl = !state.draftUrl || state.draftUrl === state.currentUrl ? next.url : state.draftUrl
    setState({
      canGoBack: next.canGoBack,
      canGoForward: next.canGoForward,
      currentUrl: next.url,
      draftUrl,
      isLoading: next.isLoading,
    })
  }

  const open = async () => {
    const api = browser()
    if (!api) return
    const url = state.draftUrl.trim() || undefined
    await openBrowserPanel({
      api,
      browserStore: browsers,
      openPanel: () => props.panel?.open(),
      setPanelOpen: (open) => annotations.setPanelOpen(open),
      url,
    })
    await activateAndSyncBrowser()
    queueMicrotask(syncBounds)
    if (!url) {
      await syncState()
      return
    }
    await syncState()
  }

  const loadConsoleMessages = async () => {
    const api = browser()
    if (!api?.getConsoleMessages) return
    const browserId = activeBrowserId()
    const request = ++consoleRequest
    const result = await api.getConsoleMessages(browserId ? { browserId } : undefined).catch(() => null)
    if (request !== consoleRequest || !panelOpen() || state.view !== "console" || activeBrowserId() !== browserId) return
    renderConsoleMessages(result?.entries ?? [])
  }

  const selectView = (nextView: "page" | "console") => {
    setState("view", nextView)
    if (nextView === "console") hideBrowser()
  }

  const clearConsoleMessages = async () => {
    const api = browser()
    if (!api?.clearConsoleMessages) return
    const browserId = activeBrowserId()
    await api.clearConsoleMessages(browserId ? { browserId } : undefined)
    await loadConsoleMessages()
  }

  const storeInspectDetail = (id: string, result: BrowserInspectResult) => {
    const api = browser()
    if (!api) return
    const detail: BrowserAnnotationDetail = {
      id,
      pageUrl: result.pageUrl,
      pageTitle: result.pageTitle,
      userComment: result.userComment,
      element: {
        tagName: result.annotation.tagName,
        role: result.annotation.role,
        accessibleName: result.annotation.accessibleName,
        visibleText: result.annotation.visibleText,
        attributes: result.annotation.attributes,
        selector: result.annotation.selector,
        xpath: result.annotation.xpath,
        boundingBox: result.annotation.boundingBox,
      },
      preview: result.preview ?? {},
      context: {
        nearbyDomSanitized: result.context?.nearbyDomSanitized ?? result.annotation.nearbyDomSanitized,
        accessibilitySnapshotNearby: result.context?.accessibilitySnapshotNearby,
      },
      viewportScreenshot: result.viewportScreenshot,
    }
    void api.storeAnnotationDetail(id, detail).catch(() => undefined)
  }

  const stopInspect = async (api: NonNullable<ReturnType<typeof browser>>) => {
    inspectRequest += 1
    annotations.stopInspectMode()
    setState("selectionPending", false)
    await api.stopInspectMode().catch(() => undefined)
  }

  const close = async () => {
    const api = browser()
    annotations.stopInspectMode()
    annotations.cancelPendingAnnotation()
    props.panel?.close()
    annotations.setPanelOpen(false)
    if (!api) return
    await api.stopInspectMode().catch(() => undefined)
  }

  const runInspectSession = async (api: NonNullable<ReturnType<typeof browser>>, request: number) => {
    setState("selectionPending", true)

    const result = await api.startInspectMode().catch(() => null)
    if (request !== inspectRequest) {
      setState("selectionPending", false)
      return
    }
    if (!result) {
      annotations.stopInspectMode()
      setState("selectionPending", false)
      return
    }
    if (!annotations.store.inspectMode) {
      setState("selectionPending", false)
      return
    }

    if (!result.userComment.trim()) {
      annotations.setPendingAnnotation({
        element: result.annotation,
        pageTitle: result.pageTitle,
        pageUrl: result.pageUrl,
        preview: result.preview,
      })
    } else {
      const annotationId = annotations.addAnnotationFromInspectResult(result)
      if (annotationId) storeInspectDetail(annotationId, result)
      setState("annotationRevision", state.annotationRevision + 1)
    }
    setState("selectionPending", false)
    if (annotations.store.inspectMode && panelOpen()) queueMicrotask(() => {
      if (request === inspectRequest) runSafely(runInspectSession(api, request))
    })
  }

  const startInspect = async () => {
    const api = browser()
    if (!api) return
    if (annotations.store.inspectMode) {
      await stopInspect(api)
      return
    }
    if (state.selectionPending) return

    const request = ++inspectRequest
    annotations.startInspectMode()
    await runInspectSession(api, request)
  }

  const addScreenshotAttachment = (base64: string) => {
    const now = Date.now()
    const attachment: ImageAttachmentPart = {
      type: "image",
      id: `browser-screenshot-${now}`,
      filename: `screenshot-${now}.png`,
      mime: "image/png",
      dataUrl: `data:image/png;base64,${base64}`,
    }
    prompt.set([...prompt.current(), attachment], prompt.cursor())
    setState("screenshotCaptured", true)
    if (screenshotFeedbackTimer) clearTimeout(screenshotFeedbackTimer)
    screenshotFeedbackTimer = setTimeout(() => {
      setState("screenshotCaptured", false)
      screenshotFeedbackTimer = undefined
    }, 1200)
  }

  const takeScreenshot = async () => {
    const api = browser()
    if (!api) return
    const base64 = await api.screenshot().catch(() => null)
    if (!base64) {
      setState("screenshotCaptured", false)
      return
    }

    addScreenshotAttachment(base64)
  }

  const goBack = async () => {
    const api = browser()
    if (!api) return
    await api.back()
    await syncState()
  }

  const goForward = async () => {
    const api = browser()
    if (!api) return
    await api.forward()
    await syncState()
  }

  const reloadPage = async () => {
    const api = browser()
    if (!api) return
    await api.reload()
    await syncState()
  }

  const selectTab = async (id: string) => {
    if (id === "default") return
    const api = browser()
    if (api?.setActiveBrowser) {
      await api.setActiveBrowser(id)
      activatedBrowserId = id
    }
    browsers.setActiveBrowser?.(id)
  }

  const newTab = async () => {
    const api = browser()
    if (!api?.createBrowser) {
      browsers.addBrowser?.(`browser-${Date.now()}`)
      return
    }
    const result = await api.createBrowser()
    browsers.addBrowser?.(result.browser.id)
    browsers.updateBrowser?.(result.browser.id, { title: result.browser.title, url: result.browser.url })
    if (result.state.activeBrowserId) browsers.setActiveBrowser?.(result.state.activeBrowserId)
  }

  const closeTab = async (id: string) => {
    if (id === "default") return
    const api = browser()
    const closingActiveTab = selectedTabId() === id
    const nextId = getNextBrowserIdAfterClose(browsers.store.instances ?? {}, browsers.store.activeId, id)
    if (closingActiveTab && nextId) closeSelectionOverride = nextId
    closeTabInProgress = true
    await api?.closeBrowser?.(id)
    browsers.removeBrowser?.(id)
    if (nextId && browsers.store.activeId !== nextId) browsers.setActiveBrowser?.(nextId)
    closeTabInProgress = false
    if (closingActiveTab) runSafely(activateAndSyncBrowser())
  }

  onMount(() => {
    setState("available", !!browser())
    if (!browser()) return
    renderConsoleMessages([])

    const disposeOpenRequest = browser()?.onOpenRequested(() => {
      runSafely(open())
    })
    const syncWindowBounds = () => syncBounds()
    window.addEventListener("resize", syncWindowBounds)
    runSafely(syncState())
    timer = setInterval(() => {
      runSafely(syncState())
      syncBounds()
    }, 400)
    onCleanup(() => {
      window.removeEventListener("resize", syncWindowBounds)
      disposeOpenRequest?.()
    })
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
    if (screenshotFeedbackTimer) clearTimeout(screenshotFeedbackTimer)
    hideBrowser()
  })

  createResizeObserver(() => view, () => syncBounds())

  let wasOpen = false
  createEffect(() => {
    pageSwitchButton?.setAttribute("aria-pressed", state.view === "page" ? "true" : "false")
    consoleSwitchButton?.setAttribute("aria-pressed", state.view === "console" ? "true" : "false")
    screenshotButton?.setAttribute("aria-label", state.screenshotCaptured ? "Screenshot captured" : "Take screenshot")
    screenshotButton?.setAttribute("title", state.screenshotCaptured ? "Screenshot captured" : "Take screenshot")
    screenshotButton?.classList.toggle("browser-panel-button-captured", state.screenshotCaptured)
    annotationButton?.setAttribute("aria-pressed", annotations.store.inspectMode ? "true" : "false")
    renderAnnotationMarkers()
    updateAnnotationCount()
  })

  createEffect(() => {
    if (!pendingAnnotation() || !panelOpen()) return
    setState("annotationDraft", "")
    queueMicrotask(() => annotationInput?.focus())
  })

  createEffect(() => {
    const open = panelOpen()
    const blocked = browserBlocked()
    if (annotations.store.panelOpen !== open) annotations.setPanelOpen(open)
    if (!open || blocked) {
      syncRequest += 1
      consoleRequest += 1
      if (browserVisible) hideBrowser()
      if (!open) wasOpen = false
      return
    }

    if (state.view === "page") runSafely(activateAndSyncBrowser())
    if (state.view === "console") runSafely(loadConsoleMessages())
    wasOpen = true
  })

  if (!state.available) return null

  return (
    <section class="browser-panel-shell">
      <BrowserPanelTabs
        tabs={browserTabs()}
        activeTabId={selectedTabId()}
        onSelectTab={(id) => runSafely(selectTab(id))}
        onNewTab={() => runSafely(newTab())}
        onCloseTab={(id) => runSafely(closeTab(id))}
      />
      <BrowserPanelToolbar
        open={panelOpen()}
        draftUrl={state.draftUrl}
        isLoading={state.isLoading}
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        inspectMode={annotations.store.inspectMode}
        inspectButtonRef={(element) => (annotationButton = element)}
        inspectDisabled={state.selectionPending && !annotations.store.inspectMode}
        screenshotCaptured={state.screenshotCaptured}
        screenshotButtonRef={(element) => (screenshotButton = element)}
        count={annotationItems().length}
        countRef={(element) => (annotationCount = element)}
        onDraftUrlChange={(value) => setState("draftUrl", value)}
        onOpen={(_event?: Event) => runSafely(open())}
        onClose={(_event?: Event) => runSafely(close())}
        onBack={(_event?: Event) => runSafely(goBack())}
        onForward={(_event?: Event) => runSafely(goForward())}
        onReload={(_event?: Event) => runSafely(reloadPage())}
        onScreenshot={(_event?: Event) => runSafely(takeScreenshot())}
        onNavigate={(_event?: Event) => runSafely(open())}
        onInspect={(_event?: Event) => runSafely(startInspect())}
      />

      <Show when={panelOpen()}>
        <div class="browser-panel-body">
          <div class="browser-panel-switch" aria-label="Browser view">
            <button
              type="button"
              class="browser-panel-switch-button"
              ref={(element) => (pageSwitchButton = element)}
              aria-pressed={state.view === "page" ? "true" : "false"}
              onClick={() => selectView("page")}
            >
              Page
            </button>
            <button
              type="button"
              class="browser-panel-switch-button"
              ref={(element) => (consoleSwitchButton = element)}
              aria-pressed={state.view === "console" ? "true" : "false"}
              onClick={() => selectView("console")}
            >
              Console
            </button>
          </div>
          <div class="browser-page-view" hidden={state.view !== "page"}>
            <div ref={(element) => (view = element)} class="browser-panel-view" />
            <div ref={(element) => (annotationOverlay = element)} class="browser-annotation-overlay" aria-label="Browser annotations" />
            <Show when={pendingAnnotation()}>
              <div
                role="dialog"
                aria-label="Annotation note"
                class="browser-annotation-editor"
                ref={(element) => (annotationEditor = element)}
                style={pendingAnnotationPosition()}
              >
                <textarea
                  ref={(element) => (annotationInput = element)}
                  aria-label="Annotation comment"
                  class="browser-annotation-input"
                  placeholder="Nota"
                  value={state.annotationDraft}
                  onInput={(event) => setState("annotationDraft", event.currentTarget.value)}
                  onKeyDown={annotationEditorKeyDown}
                />
              </div>
            </Show>
            <Show when={annotations.store.inspectMode || state.selectionPending}>
              <div class="browser-panel-hint">Select an element in the page to add a note.</div>
            </Show>
          </div>
          <div class="browser-console-view" hidden={state.view !== "console"}>
              <div class="browser-console-toolbar">
                <span ref={(element) => (consoleCount = element)} class="browser-console-count">
                  0 messages
                </span>
                <button type="button" class="browser-console-clear" onClick={() => runSafely(clearConsoleMessages())}>
                  Clear
                </button>
              </div>
              <div ref={(element) => (consoleContent = element)} class="browser-console-content">
                <div class="browser-console-empty">No console messages yet.</div>
              </div>
          </div>
        </div>
      </Show>
    </section>
  )
}
