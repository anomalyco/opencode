import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { useVisualization } from "../context/visualization"
import { createVisualizationDocument } from "./visualization-document"
import {
  COLLAPSED_HEIGHT,
  FOLLOW_UP_INIT_TIMEOUT_MS,
  INITIAL_HEIGHT,
  MAX_THEME_VALUE_CODE_POINTS,
  VISUALIZATION_THEME_VARIABLES,
  clampVisualizationHeight,
  decodeVisualizationMessage,
  type VisualizationHostMessage,
  type VisualizationMessage,
  type VisualizationResult,
  type VisualizationTheme,
} from "./visualization-schema"

export type VisualizationFrameProps = {
  value: VisualizationResult
  sessionID?: string
  onContentRendered?: () => void
}

export function filterVisualizationMessage(input: {
  source: MessageEventSource | null
  frameWindow: MessageEventSource | null
  data: unknown
  token: string
  generation: number
  currentGeneration: number
}): VisualizationMessage | undefined {
  if (!input.frameWindow || input.source !== input.frameWindow) return
  if (input.generation !== input.currentGeneration) return
  const message = decodeVisualizationMessage(input.data)
  if (!message || message.token !== input.token) return
  return message
}

export function resolveVisualizationFrameHeight(value: number) {
  return clampVisualizationHeight(value)
}

export function displayVisualizationHeight(value: number, expanded: boolean) {
  const height = resolveVisualizationFrameHeight(value) ?? INITIAL_HEIGHT
  if (expanded) return height
  return Math.min(height, COLLAPSED_HEIGHT)
}

export function VisualizationFrame(props: VisualizationFrameProps) {
  const i18n = useI18n()
  const visualization = useVisualization()
  const source = createMemo(() => createVisualizationDocument(props.value.html))
  const [generation, setGeneration] = createSignal(0)
  const [height, setHeight] = createSignal(INITIAL_HEIGHT)
  const [expanded, setExpanded] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  let iframe: HTMLIFrameElement | undefined
  let currentGeneration = 0
  let token = ""
  let mounted = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let heightFrame: number | undefined
  let pendingHeight: number | undefined
  let observer: MutationObserver | undefined
  let followUpGeneration: number | undefined

  const clearPending = () => {
    if (timeout) clearTimeout(timeout)
    timeout = undefined
    if (heightFrame !== undefined) cancelAnimationFrame(heightFrame)
    heightFrame = undefined
    pendingHeight = undefined
  }

  const createToken = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
    const values = new Uint32Array(4)
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(values)
      return Array.from(values, (value) => value.toString(36)).join("-")
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const theme = (): VisualizationTheme => {
    if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return {}
    const style = getComputedStyle(document.documentElement)
    return VISUALIZATION_THEME_VARIABLES.reduce<VisualizationTheme>((result, name) => {
      const value = style.getPropertyValue(name).trim()
      if (Array.from(value).length <= MAX_THEME_VALUE_CODE_POINTS) result[name] = value
      return result
    }, {})
  }

  const post = (targetGeneration: number, message: VisualizationHostMessage) => {
    if (!mounted || failed() || targetGeneration !== currentGeneration) return false
    const target = iframe?.contentWindow
    if (!target) return false
    target.postMessage(message, "*")
    return true
  }

  const fail = (targetGeneration: number) => {
    if (!mounted || targetGeneration !== currentGeneration) return
    clearPending()
    setReady(false)
    setFailed(true)
  }

  const startTimeout = (targetGeneration: number) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => fail(targetGeneration), FOLLOW_UP_INIT_TIMEOUT_MS)
  }

  const postTheme = () => {
    if (!ready()) return
    post(currentGeneration, { version: 1, type: "theme", token, theme: theme() })
  }

  const queueHeight = (next: number) => {
    const value = resolveVisualizationFrameHeight(next)
    if (value === undefined) return
    pendingHeight = value
    if (heightFrame !== undefined) return
    heightFrame = requestAnimationFrame(() => {
      heightFrame = undefined
      const value = pendingHeight
      pendingHeight = undefined
      if (!mounted || failed() || value === undefined || value === height()) return
      setHeight(value)
      props.onContentRendered?.()
    })
  }

  const settleFollowUp = (targetGeneration: number, requestID: string, status: "sent" | "cancelled" | "rejected") => {
    if (!mounted || failed() || targetGeneration !== currentGeneration || followUpGeneration !== targetGeneration)
      return
    followUpGeneration = undefined
    post(targetGeneration, { version: 1, type: "followup-result", token, requestID, status })
  }

  const handleFollowUp = (message: Extract<VisualizationMessage, { type: "followup" }>) => {
    const targetGeneration = currentGeneration
    if (followUpGeneration === targetGeneration || !props.sessionID) {
      post(targetGeneration, {
        version: 1,
        type: "followup-result",
        token,
        requestID: message.requestID,
        status: "rejected",
      })
      return
    }
    followUpGeneration = targetGeneration
    void visualization
      .followUp({
        sessionID: props.sessionID,
        title: message.title ?? props.value.title,
        prompt: message.prompt,
      })
      .then(
        (status) => settleFollowUp(targetGeneration, message.requestID, status),
        () => settleFollowUp(targetGeneration, message.requestID, "rejected"),
      )
  }

  const onMessage = (event: MessageEvent) => {
    if (!mounted || failed()) return
    const message = filterVisualizationMessage({
      source: event.source,
      frameWindow: iframe?.contentWindow ?? null,
      data: event.data,
      token,
      generation: currentGeneration,
      currentGeneration: generation(),
    })
    if (!message) return
    if (message.type === "ready") {
      if (timeout) clearTimeout(timeout)
      timeout = undefined
      setReady(true)
      return
    }
    if (message.type === "resize") {
      queueHeight(message.height)
      return
    }
    if (message.type === "followup") {
      handleFollowUp(message)
      return
    }
    if (message.type === "error") fail(currentGeneration)
  }

  const onLoad = (targetGeneration: number) => {
    if (!mounted || failed() || targetGeneration !== currentGeneration) return
    if (!post(targetGeneration, { version: 1, type: "init", token, theme: theme() })) return
    startTimeout(targetGeneration)
  }

  const start = () => {
    clearPending()
    currentGeneration += 1
    token = createToken()
    followUpGeneration = undefined
    setHeight(INITIAL_HEIGHT)
    setExpanded(false)
    setReady(false)
    setFailed(false)
    setGeneration(currentGeneration)
  }

  onMount(() => {
    mounted = true
    window.addEventListener("message", onMessage)
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(postTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
      })
    }
    start()
  })

  createEffect(
    on(
      () => source(),
      () => {
        if (mounted) start()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    mounted = false
    currentGeneration += 1
    followUpGeneration = undefined
    clearPending()
    observer?.disconnect()
    window.removeEventListener("message", onMessage)
  })

  return (
    <div data-component="visualization-frame" data-expanded={expanded() ? "true" : "false"}>
      <Show
        when={!failed()}
        fallback={
          <div data-slot="visualization-frame-failed">
            <span>{i18n.t("ui.toolErrorCard.failed")}</span>
            <IconButton
              icon="reset"
              size="small"
              variant="ghost"
              aria-label={i18n.t("ui.sessionTurn.retry.retrying")}
              onClick={start}
            />
          </div>
        }
      >
        <div
          data-slot="visualization-frame-container"
          style={{ height: `${displayVisualizationHeight(height(), expanded())}px` }}
        >
          <Show when={generation()} keyed>
            {(value) => (
              <iframe
                ref={(element) => (iframe = element)}
                data-slot="visualization-frame"
                title={props.value.title}
                sandbox="allow-scripts"
                loading="lazy"
                srcdoc={source()}
                onLoad={() => onLoad(value)}
                onError={() => fail(value)}
              />
            )}
          </Show>
        </div>
        <Show when={height() > COLLAPSED_HEIGHT}>
          <div data-slot="visualization-frame-actions">
            <IconButton
              icon={expanded() ? "collapse" : "expand"}
              size="small"
              variant="ghost"
              aria-label={i18n.t(expanded() ? "ui.message.collapse" : "ui.message.expand")}
              onClick={() => setExpanded((value) => !value)}
            />
          </div>
        </Show>
      </Show>
    </div>
  )
}
