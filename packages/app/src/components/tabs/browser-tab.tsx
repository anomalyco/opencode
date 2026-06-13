import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@cedric/ui/icon-button"
import { Icon } from "@cedric/ui/icon"

interface BrowserTabProps {
  title?: string
  url?: string
  active?: boolean
  annotations?: BrowserAnnotation[]
  onTitleChange?: (title: string) => void
  onUrlChange?: (url: string) => void
  onAnnotationsChange?: (annotations: BrowserAnnotation[]) => void
  onSendToChat?: (context: { title?: string; url: string; annotations?: BrowserAnnotation[] }) => void
  onSendToMainChat?: (context: { title?: string; url: string; annotations?: BrowserAnnotation[] }) => void
}

interface BrowserWebview extends HTMLElement {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getWebContentsId: () => number
  goBack: () => void
  goForward: () => void
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  loadURL: (url: string) => Promise<void>
  reload: () => void
  src: string
}

export type BrowserAnnotation = {
  id: string
  type: "highlight" | "note"
  url: string
  title?: string
  text: string
  note?: string
  createdAt: number
}

function eventString(event: Event, key: string) {
  const value = Reflect.get(event, key)
  return typeof value === "string" ? value : ""
}

function eventNumber(event: Event, key: string) {
  const value = Reflect.get(event, key)
  return typeof value === "number" ? value : 0
}

type BrowserState = {
  currentUrl: string
  displayUrl: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  error: string
  ready: boolean
  loadAttempts: number
}

const searchEngineUrl = "https://duckduckgo.com/?q="
let annotationCounter = 0

export const DEFAULT_BROWSER_URL = "https://duckduckgo.com"

export function normalizeBrowserUrl(input: string) {
  const value = input.trim()
  if (!value) return ""
  if (value.includes(" ")) return `${searchEngineUrl}${encodeURIComponent(value)}`
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|about:|data:|file:)/i.test(value)) return value

  const isLocalHost =
    /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(value) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/.test(value)

  if (!/[.:/]/.test(value)) {
    return `${searchEngineUrl}${encodeURIComponent(value)}`
  }

  return `${isLocalHost ? "http" : "https"}://${value}`
}

export function browserTabTitle(url?: string) {
  const normalized = normalizeBrowserUrl(url ?? "")
  if (!normalized) return "Browser"

  try {
    const parsed = new URL(normalized)
    return parsed.hostname || parsed.protocol.replace(":", "") || "Browser"
  } catch {
    return "Browser"
  }
}

function cleanAnnotationText(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

function normalizedPageKey(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return url
  }
}

function annotationPageMatches(annotation: BrowserAnnotation, url: string) {
  return normalizedPageKey(annotation.url) === normalizedPageKey(url)
}

export function normalizeBrowserAnnotations(value: unknown): BrowserAnnotation[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): BrowserAnnotation[] => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    if (record.type !== "highlight" && record.type !== "note") return []
    if (typeof record.id !== "string" || !record.id) return []
    if (typeof record.url !== "string" || !record.url) return []
    if (typeof record.createdAt !== "number") return []

    return [
      {
        id: record.id,
        type: record.type,
        url: record.url,
        title: typeof record.title === "string" ? record.title : undefined,
        text: typeof record.text === "string" ? record.text : "",
        note: typeof record.note === "string" ? record.note : undefined,
        createdAt: record.createdAt,
      },
    ]
  })
}

export function browserAnnotationsText(annotations: BrowserAnnotation[]) {
  const usable = annotations.filter((annotation) => cleanAnnotationText(annotation.text) || cleanAnnotationText(annotation.note))
  if (!usable.length) return ""

  return [
    "<browser-annotations>",
    ...usable.map((annotation, index) =>
      [
        `Annotation ${index + 1} (${annotation.type})`,
        `URL: ${annotation.url}`,
        ...(annotation.title ? [`Title: ${annotation.title}`] : []),
        ...(cleanAnnotationText(annotation.text) ? [`Text: ${cleanAnnotationText(annotation.text)}`] : []),
        ...(cleanAnnotationText(annotation.note) ? [`Note: ${cleanAnnotationText(annotation.note)}`] : []),
      ].join("\n"),
    ),
    "</browser-annotations>",
  ].join("\n")
}

export function BrowserTab(props: BrowserTabProps) {
  const initialUrl = normalizeBrowserUrl(props.url ?? DEFAULT_BROWSER_URL) || DEFAULT_BROWSER_URL
  const [state, setState] = createStore<BrowserState>({
    currentUrl: initialUrl,
    displayUrl: initialUrl,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    error: "",
    ready: false,
    loadAttempts: 0,
  })
  const [webviewSlot, setWebviewSlot] = createSignal<{ id: number } | null>(null)
  const [annotationsOpen, setAnnotationsOpen] = createSignal(false)
  const [annotationStatus, setAnnotationStatus] = createSignal("")
  const [noteDraft, setNoteDraft] = createSignal("")

  let mountTimer: ReturnType<typeof setTimeout> | undefined
  let loadTimeout: ReturnType<typeof setTimeout> | undefined
  let hostResizeObserver: ResizeObserver | undefined
  const [webviewRef, setWebviewRef] = createSignal<BrowserWebview | undefined>(undefined)
  let webviewHostRef: HTMLDivElement | undefined
  const desktopWindow = window as Window & {
    api?: {
      setActiveWebview?: (id: number) => Promise<boolean>
      clearActiveWebview?: (id?: number) => Promise<boolean>
    }
  }
  const pageAnnotations = createMemo(() => (props.annotations ?? []).filter((item) => annotationPageMatches(item, state.currentUrl)))
  const annotationCount = createMemo(() => pageAnnotations().length)

  const getWebviewValue = <T,>(fn: (view: BrowserWebview) => T, fallback: T) => {
    const ref = webviewRef()
    if (!ref || !state.ready) return fallback
    try {
      return fn(ref)
    } catch {
      return fallback
    }
  }

  const syncNavigationState = () => {
    setState("canGoBack", getWebviewValue((view) => view.canGoBack(), false))
    setState("canGoForward", getWebviewValue((view) => view.canGoForward(), false))
  }

  const registerActiveWebview = () => {
    const ref = webviewRef()
    if (!props.active || !desktopWindow.api?.setActiveWebview || !ref) return false

    try {
      void desktopWindow.api.setActiveWebview(ref.getWebContentsId())
      return true
    } catch {
      return false
    }
  }

  const clearActiveWebview = () => {
    const ref = webviewRef()
    if (!desktopWindow.api?.clearActiveWebview || !ref) return

    try {
      void desktopWindow.api.clearActiveWebview(ref.getWebContentsId())
    } catch {
      return
    }
  }

  const commitUrl = (url: string) => {
    setState("currentUrl", url)
    setState("displayUrl", url)
    setState("error", "")
    props.onUrlChange?.(url)
  }

  const resetGuestState = () => {
    setState({
      ready: false,
      canGoBack: false,
      canGoForward: false,
      isLoading: true,
      error: "",
    })
  }

  const attachWebviewHostRef = (element: HTMLDivElement) => {
    webviewHostRef = element
    hostResizeObserver?.disconnect()

    if (typeof ResizeObserver === "undefined") return

    hostResizeObserver = new ResizeObserver(() => {
      if (props.active && !webviewSlot()) {
        scheduleWebviewMount()
      }
    })
    hostResizeObserver.observe(element)

    if (props.active && !webviewSlot()) {
      scheduleWebviewMount()
    }
  }

  const scheduleWebviewMount = () => {
    if (!props.active) return
    if (webviewSlot()) return

    clearTimeout(mountTimer)

    const attemptMount = (attemptsLeft = 80) => {
      if (!props.active) return

      const rect = webviewHostRef?.getBoundingClientRect()
      if (!rect || rect.width < 200 || rect.height < 120) {
        if (attemptsLeft <= 0) return
        mountTimer = setTimeout(() => attemptMount(attemptsLeft - 1), 50)
        return
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const nextRect = webviewHostRef?.getBoundingClientRect()
          if (!nextRect || nextRect.width < 200 || nextRect.height < 120) {
            if (attemptsLeft <= 0) return
            mountTimer = setTimeout(() => attemptMount(attemptsLeft - 1), 50)
            return
          }

          resetGuestState()
          setWebviewSlot({ id: Date.now() })
        })
      })
    }

    attemptMount()
  }

  const navigate = (input = state.displayUrl) => {
    const ref = webviewRef()
    if (!ref) return
    const target = normalizeBrowserUrl(input)
    if (!target) return
    commitUrl(target)
    setState("isLoading", true)
    if (!state.ready) {
      ref.src = target
      return
    }

    try {
      void ref.loadURL(target)
    } catch {
      ref.src = target
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") navigate()
  }

  const goBack = () => {
    const ref = webviewRef()
    if (ref && ref.canGoBack()) {
      ref.goBack()
    }
  }

  const goForward = () => {
    const ref = webviewRef()
    if (ref && ref.canGoForward()) {
      ref.goForward()
    }
  }

  const reload = () => {
    const ref = webviewRef()
    if (ref) {
      ref.reload()
    }
  }

  const handleRetry = () => {
    if (state.loadAttempts >= 2) {
      setState("error", "Max retries reached. The page may be unavailable.")
      return
    }
    setState("loadAttempts", state.loadAttempts + 1)
    setState("error", "")
    const ref = webviewRef()
    if (ref) {
      ref.reload()
    } else {
      navigate()
    }
  }

  const openExternal = () => {
    window.open(state.currentUrl, "_blank")
  }

  const readSelectedText = async () => {
    const ref = webviewRef()
    if (!ref || !state.ready) return ""

    try {
      const text = await ref.executeJavaScript<string>(
        `(() => (window.getSelection()?.toString() ?? "").replace(/\\s+/g, " ").trim())()`,
        true,
      )
      return typeof text === "string" ? text : ""
    } catch {
      return ""
    }
  }

  const saveAnnotation = (type: BrowserAnnotation["type"], text: string, note?: string) => {
    const cleanedText = cleanAnnotationText(text)
    const cleanedNote = cleanAnnotationText(note)
    if (!cleanedText && !cleanedNote) return false

    props.onAnnotationsChange?.([
      ...(props.annotations ?? []),
      {
        id: `browser-annotation-${Date.now()}-${++annotationCounter}`,
        type,
        url: state.currentUrl,
        title: props.title,
        text: cleanedText,
        note: cleanedNote || undefined,
        createdAt: Date.now(),
      },
    ])
    setAnnotationsOpen(true)
    setNoteDraft("")
    setAnnotationStatus(type === "highlight" ? "Selection saved." : "Note saved.")
    return true
  }

  const saveSelectedText = async () => {
    const text = await readSelectedText()
    if (saveAnnotation("highlight", text)) return
    setAnnotationStatus("Select text in the page first.")
  }

  const saveNote = async () => {
    const text = await readSelectedText()
    if (saveAnnotation("note", text, noteDraft())) return
    setAnnotationStatus("Select page text or type a note.")
  }

  const removeAnnotation = (id: string) => {
    props.onAnnotationsChange?.((props.annotations ?? []).filter((annotation) => annotation.id !== id))
  }

  const sendToChat = () => {
    props.onSendToChat?.({
      title: props.title,
      url: state.currentUrl,
      annotations: pageAnnotations(),
    })
  }

  const sendToMainChat = () => {
    props.onSendToMainChat?.({
      title: props.title,
      url: state.currentUrl,
      annotations: pageAnnotations(),
    })
  }

  createEffect(
    on(
      () => props.url,
      (url) => {
        const target = normalizeBrowserUrl(url ?? DEFAULT_BROWSER_URL) || DEFAULT_BROWSER_URL
        if (target === state.currentUrl) return

        commitUrl(target)
        const ref = webviewRef()
        if (!ref) {
          scheduleWebviewMount()
          return
        }
        if (!state.ready) {
          if (ref.src !== target) ref.src = target
          return
        }

        if (getWebviewValue((view) => view.getURL(), "") === target) return
        setState("isLoading", true)
        void ref.loadURL(target)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.active,
      (active) => {
        if (active && !webviewSlot()) {
          scheduleWebviewMount()
          return
        }
        const ref = webviewRef()
        if (!active) {
          clearActiveWebview()
          return
        }
        if (!ref || !state.ready) return
        registerActiveWebview()
        syncNavigationState()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    scheduleWebviewMount()
  })

  onCleanup(() => {
    clearTimeout(mountTimer)
    if (loadTimeout) clearTimeout(loadTimeout)
    hostResizeObserver?.disconnect()
    clearActiveWebview()
  })

  createEffect(() => {
    const ref = webviewRef()
    if (!ref) return
    registerActiveWebview()

    const handleNavigation = (event: Event) => {
      const url = eventString(event, "url")
      if (!url) return
      commitUrl(url)
      setAnnotationStatus("")
      syncNavigationState()
    }

    const handleDidStartLoading = () => {
      setState("isLoading", true)
      setState("error", "")
      // Clear any existing timeout
      if (loadTimeout) clearTimeout(loadTimeout)
      // Set 15-second load timeout
      loadTimeout = setTimeout(() => {
        if (state.isLoading) {
          setState("isLoading", false)
          setState("error", `Page load timed out after 15 seconds. Attempt ${state.loadAttempts + 1} of 3.`)
        }
      }, 15000)
    }

    const handleLoadSettled = () => {
      if (loadTimeout) {
        clearTimeout(loadTimeout)
        loadTimeout = undefined
      }
      setState("isLoading", false)
      setState("loadAttempts", 0)
      syncNavigationState()
      registerActiveWebview()
    }

    const handlePageTitleUpdated = (event: Event) => {
      const title = eventString(event, "title")
      if (title && props.onTitleChange) {
        props.onTitleChange(title)
      }
    }

    const handleDidFailLoad = (event: Event) => {
      if (eventNumber(event, "errorCode") === -3) return
      if (loadTimeout) {
        clearTimeout(loadTimeout)
        loadTimeout = undefined
      }
      setState("isLoading", false)
      setState("error", eventString(event, "errorDescription") || "Could not load page")
    }

    const handleNewWindow = (event: Event) => {
      event.preventDefault()
      navigate(eventString(event, "url"))
    }

    const handleDomReady = () => {
      setState("ready", true)
      syncNavigationState()
      if (registerActiveWebview()) return
      setTimeout(() => {
        void registerActiveWebview()
      }, 500)
    }

    ref.addEventListener("did-navigate", handleNavigation)
    ref.addEventListener("did-navigate-in-page", handleNavigation)
    ref.addEventListener("did-start-loading", handleDidStartLoading)
    ref.addEventListener("did-stop-loading", handleLoadSettled)
    ref.addEventListener("did-finish-load", handleLoadSettled)
    ref.addEventListener("dom-ready", handleDomReady)
    ref.addEventListener("page-title-updated", handlePageTitleUpdated)
    ref.addEventListener("did-fail-load", handleDidFailLoad)
    ref.addEventListener("new-window", handleNewWindow)

    onCleanup(() => {
      if (loadTimeout) clearTimeout(loadTimeout)
      ref.removeEventListener("did-navigate", handleNavigation)
      ref.removeEventListener("did-navigate-in-page", handleNavigation)
      ref.removeEventListener("did-start-loading", handleDidStartLoading)
      ref.removeEventListener("did-stop-loading", handleLoadSettled)
      ref.removeEventListener("did-finish-load", handleLoadSettled)
      ref.removeEventListener("dom-ready", handleDomReady)
      ref.removeEventListener("page-title-updated", handlePageTitleUpdated)
      ref.removeEventListener("did-fail-load", handleDidFailLoad)
      ref.removeEventListener("new-window", handleNewWindow)
    })
  })

  return (
    <div class="flex flex-col h-full bg-background-base">
      <div class="flex items-center gap-1 px-2 py-1.5 border-b border-border-weaker-base bg-background-base shrink-0">
        <IconButton
          icon="arrow-left"
          variant="ghost"
          class="w-7 h-7"
          onClick={goBack}
          disabled={!state.canGoBack}
        />
        <IconButton
          icon="arrow-right"
          variant="ghost"
          class="w-7 h-7"
          onClick={goForward}
          disabled={!state.canGoForward}
        />
        <IconButton
          icon="reset"
          variant="ghost"
          class="w-7 h-7"
          onClick={reload}
        />
        <IconButton
          icon="edit"
          variant="ghost"
          class="w-7 h-7"
          onClick={() => void saveSelectedText()}
          disabled={!state.ready}
          title="Save selected text"
          aria-label="Save selected text"
        />
        <IconButton
          icon="checklist"
          variant="ghost"
          class="w-7 h-7"
          classList={{ "text-icon-info-active": annotationsOpen() || annotationCount() > 0 }}
          onClick={() => setAnnotationsOpen(!annotationsOpen())}
          title="Show browser annotations"
          aria-label="Show browser annotations"
        />
        <IconButton
          icon="comment"
          variant="ghost"
          class="w-7 h-7"
          onClick={sendToChat}
          disabled={!state.currentUrl}
          title="Send page to Side Chat"
          aria-label="Send page to Side Chat"
        />
        <IconButton
          icon="prompt"
          variant="ghost"
          class="w-7 h-7"
          onClick={sendToMainChat}
          disabled={!state.currentUrl}
          title="Send page to Main Chat"
          aria-label="Send page to Main Chat"
        />

        <div class="flex-1 flex items-center px-2 py-1 bg-background-stronger rounded-md">
          <Icon name="shield" class="w-3.5 h-3.5 text-text-weak mr-1.5 shrink-0" />
          <input
            type="text"
            class="flex-1 bg-transparent border-none outline-none text-13-regular text-text-base"
            value={state.displayUrl}
            onInput={(e) => setState("displayUrl", e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <Show when={state.isLoading}>
          <div class="text-12-regular text-text-weak shrink-0 animate-pulse">Loading...</div>
        </Show>
        <Show when={!state.isLoading && state.error}>
          <div class="flex items-center gap-2 shrink-0">
            <div class="max-w-40 truncate text-12-regular text-icon-critical-base" title={state.error}>
              {state.error}
            </div>
            <Show when={state.loadAttempts < 2}>
              <button
                class="text-12-regular text-icon-info-active hover:underline px-1.5 py-0.5 rounded hover:bg-background-stronger transition-colors"
                onClick={handleRetry}
              >
                Retry
              </button>
            </Show>
            <button
              class="text-12-regular text-text-weak hover:text-text-base px-1.5 py-0.5 rounded hover:bg-background-stronger transition-colors"
              onClick={openExternal}
            >
              Open External
            </button>
          </div>
        </Show>
      </div>

      <div ref={attachWebviewHostRef} class="flex-1 min-w-0 relative">
        <Show when={webviewSlot()} fallback={<div class="h-full w-full bg-background-base" />}>
          <webview
            ref={setWebviewRef}
            src={state.currentUrl}
            class="w-full h-full"
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          ></webview>
        </Show>
        <Show when={annotationsOpen()}>
          <aside class="absolute right-0 top-0 z-10 flex h-full w-[280px] flex-col border-l border-border-weaker-base bg-background-base shadow-[var(--v2-elevation-raised)]">
            <div class="flex min-h-11 items-center justify-between gap-2 border-b border-border-weaker-base px-3">
              <div class="min-w-0">
                <div class="truncate text-13-medium text-text-base">Annotations</div>
                <div class="text-11-regular text-text-weak">{annotationCount()} on this page</div>
              </div>
              <IconButton
                icon="close-small"
                variant="ghost"
                class="size-6 shrink-0"
                aria-label="Close annotations"
                onClick={() => setAnnotationsOpen(false)}
              />
            </div>

            <div class="shrink-0 space-y-2 border-b border-border-weaker-base p-3">
              <textarea
                rows={3}
                value={noteDraft()}
                placeholder="Add a note, or select page text first..."
                class="min-h-20 w-full resize-none rounded-md border border-border-weaker-base bg-background-stronger px-2 py-1.5 text-12-regular leading-5 text-text-base outline-none placeholder:text-text-weaker focus:border-border-base"
                onInput={(event) => setNoteDraft(event.currentTarget.value)}
              />
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-md border border-border-weaker-base px-2 py-1 text-12-regular text-text-base hover:bg-background-stronger"
                  onClick={() => void saveSelectedText()}
                  disabled={!state.ready}
                >
                  Save Selection
                </button>
                <button
                  type="button"
                  class="rounded-md bg-text-base px-2 py-1 text-12-regular text-background-base disabled:opacity-40"
                  onClick={() => void saveNote()}
                  disabled={!state.ready && !noteDraft().trim()}
                >
                  Save Note
                </button>
              </div>
              <Show when={annotationStatus()}>
                {(status) => <div class="text-11-regular text-text-weak">{status()}</div>}
              </Show>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <Show
                when={pageAnnotations().length > 0}
                fallback={<div class="px-3 py-6 text-center text-12-regular text-text-weak">No annotations for this page.</div>}
              >
                <For each={pageAnnotations()}>
                  {(annotation) => (
                    <div class="group border-b border-border-weaker-base px-3 py-2">
                      <div class="mb-1 flex items-center justify-between gap-2">
                        <div class="text-11-regular capitalize text-text-weak">{annotation.type}</div>
                        <IconButton
                          icon="trash"
                          variant="ghost"
                          class="size-5 shrink-0 opacity-70 hover:opacity-100"
                          aria-label="Delete annotation"
                          onClick={() => removeAnnotation(annotation.id)}
                        />
                      </div>
                      <Show when={annotation.text}>
                        {(text) => <div class="text-12-regular leading-5 text-text-base">{text()}</div>}
                      </Show>
                      <Show when={annotation.note}>
                        {(note) => <div class="mt-1 text-12-regular leading-5 text-text-weak">{note()}</div>}
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </aside>
        </Show>
      </div>
    </div>
  )
}
