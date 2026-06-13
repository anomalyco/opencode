import {
  markQuestionFlow,
  questionFlowElementMetrics,
  questionFlowViewportMetrics,
} from "./session-question-flow-debug"

type QuestionFlipRect = {
  top: number
  left: number
  width: number
  height: number
}

type QuestionFlipViewport = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  bottomGap: number
}

type QuestionFlipSnapshot = {
  requestID: string
  sessionID: string
  rect: QuestionFlipRect
  viewport: QuestionFlipViewport | undefined
  createdAt: number
}

const QUESTION_FLIP_MAX_AGE_MS = 2_500
const QUESTION_FLIP_BOTTOM_THRESHOLD = 120
const QUESTION_FLIP_DURATION_MS = 220
const QUESTION_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const QUESTION_TOOL_SELECTOR =
  '[data-component="tool-part-wrapper"][data-tool="question"][data-question-handoff="answer"], [data-component="tool-part-wrapper"][data-tool="question"][data-tool-status="completed"], [data-component="tool-part-wrapper"][data-tool="question"][data-tool-status="error"]'

const pending = new Map<string, QuestionFlipSnapshot>()
let recent: QuestionFlipSnapshot | undefined

function rectOf(element: HTMLElement): QuestionFlipRect {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function viewportOf(element: HTMLElement | null): QuestionFlipViewport | undefined {
  if (!element) return undefined
  const max = Math.max(0, element.scrollHeight - element.clientHeight)
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    bottomGap: Math.max(0, max - element.scrollTop),
  }
}

function currentViewport(): HTMLElement | null {
  const element = document.querySelector(".scroll-view__viewport")
  return element instanceof HTMLElement ? element : null
}

function expired(snapshot: QuestionFlipSnapshot): boolean {
  return performance.now() - snapshot.createdAt > QUESTION_FLIP_MAX_AGE_MS
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function cleanupExpired(): void {
  for (const [requestID, snapshot] of pending) {
    if (!expired(snapshot)) continue
    pending.delete(requestID)
    if (recent?.requestID === requestID) recent = undefined
    markQuestionFlow(
      "flip-expired",
      {
        ageMs: Math.round(performance.now() - snapshot.createdAt),
        pending: pending.size,
      },
      { sessionID: snapshot.sessionID, requestID },
    )
  }
}

function matchSnapshot(sessionID: string | undefined): QuestionFlipSnapshot | undefined {
  cleanupExpired()
  const latest = recent
  if (latest && !expired(latest) && (!sessionID || latest.sessionID === sessionID)) return latest

  for (const snapshot of Array.from(pending.values()).reverse()) {
    if (expired(snapshot)) continue
    if (sessionID && snapshot.sessionID !== sessionID) continue
    return snapshot
  }

  return undefined
}

function findQuestionTarget(root: ParentNode, snapshot: QuestionFlipSnapshot): HTMLElement | undefined {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(QUESTION_TOOL_SELECTOR)).filter(visible)
  const matching = candidates.filter((element) => element.dataset.sessionId === snapshot.sessionID)
  return matching.at(-1) ?? candidates.at(-1)
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function animateTarget(target: HTMLElement, first: QuestionFlipRect, last: QuestionFlipRect): void {
  if (reducedMotion()) {
    markQuestionFlow("flip-animate-skip", { reason: "reduced-motion" })
    return
  }
  if (last.width <= 0 || last.height <= 0) {
    markQuestionFlow("flip-animate-skip", { reason: "empty-last", lastHeight: Math.round(last.height) })
    return
  }

  const dx = first.left - last.left
  const dy = first.top - last.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    markQuestionFlow("flip-animate-skip", { reason: "same-position", dx: Math.round(dx), dy: Math.round(dy) })
    return
  }

  const scaleX = clamp(first.width / last.width, 0.94, 1.06)
  const scaleY = clamp(first.height / last.height, 0.82, 1.18)
  const from = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`

  target.dataset.questionFlip = "playing"
  target.style.transformOrigin = "top left"
  target.style.willChange = "transform, opacity"
  target.style.transform = from
  target.style.opacity = "0.88"

  const animation = target.animate(
    [
      { transform: from, opacity: 0.88 },
      { transform: "translate(0, 0) scale(1, 1)", opacity: 1 },
    ],
    {
      duration: QUESTION_FLIP_DURATION_MS,
      easing: QUESTION_FLIP_EASING,
      fill: "forwards",
    },
  )

  void animation.finished.finally(() => {
    target.style.removeProperty("transform-origin")
    target.style.removeProperty("will-change")
    target.style.removeProperty("transform")
    target.style.removeProperty("opacity")
    delete target.dataset.questionFlip
    markQuestionFlow("flip-cleanup")
  })
}

export function captureQuestionFlipSource(input: {
  requestID: string
  sessionID: string
  source: HTMLElement | undefined
}): void {
  const source = input.source
  if (!source) {
    markQuestionFlow("flip-capture-skip", { reason: "no-source" }, input)
    return
  }
  const rect = rectOf(source)
  if (rect.width <= 0 || rect.height <= 0) {
    markQuestionFlow(
      "flip-capture-skip",
      { reason: "empty-source", sourceHeight: Math.round(rect.height), sourceWidth: Math.round(rect.width) },
      input,
    )
    return
  }

  const snapshot: QuestionFlipSnapshot = {
    requestID: input.requestID,
    sessionID: input.sessionID,
    rect,
    viewport: viewportOf(currentViewport()),
    createdAt: performance.now(),
  }

  pending.set(snapshot.requestID, snapshot)
  recent = snapshot
  markQuestionFlow(
    "flip-capture",
    {
      sourceTop: Math.round(rect.top),
      sourceHeight: Math.round(rect.height),
      sourceWidth: Math.round(rect.width),
      pending: pending.size,
      ...(snapshot.viewport
        ? {
            viewportTop: Math.round(snapshot.viewport.scrollTop),
            viewportScrollHeight: Math.round(snapshot.viewport.scrollHeight),
            viewportClientHeight: Math.round(snapshot.viewport.clientHeight),
            viewportBottomGap: Math.round(snapshot.viewport.bottomGap),
          }
        : { viewportRect: "none" }),
    },
    input,
  )
}

export function playPendingQuestionFlip(input: { root: ParentNode; viewport: HTMLElement | undefined }): boolean {
  const viewport = input.viewport
  const sessionID = recent?.sessionID
  const snapshot = matchSnapshot(sessionID)
  if (!snapshot) {
    markQuestionFlow("flip-play-skip", { reason: "no-snapshot" })
    return false
  }

  markQuestionFlow(
    "flip-play-attempt",
    {
      ageMs: Math.round(performance.now() - snapshot.createdAt),
      pending: pending.size,
      ...questionFlowViewportMetrics(viewport, "viewport"),
    },
    { sessionID: snapshot.sessionID, requestID: snapshot.requestID },
  )

  const target = findQuestionTarget(input.root, snapshot)
  if (!target) {
    markQuestionFlow(
      "flip-play-skip",
      {
        reason: "no-target",
        candidates: input.root.querySelectorAll(QUESTION_TOOL_SELECTOR).length,
      },
      { sessionID: snapshot.sessionID, requestID: snapshot.requestID },
    )
    return false
  }
  if (target.dataset.questionFlip === "playing") {
    markQuestionFlow("flip-play-skip", { reason: "target-playing" }, { sessionID: snapshot.sessionID, requestID: snapshot.requestID })
    return false
  }
  if (target.dataset.questionHandoff === "answer") {
    pending.delete(snapshot.requestID)
    if (recent?.requestID === snapshot.requestID) recent = undefined
    markQuestionFlow(
      "flip-play-skip",
      { reason: "handoff-answer" },
      { sessionID: snapshot.sessionID, requestID: snapshot.requestID },
    )
    return false
  }

  pending.delete(snapshot.requestID)
  if (recent?.requestID === snapshot.requestID) recent = undefined

  const shouldPin = snapshot.viewport ? snapshot.viewport.bottomGap <= QUESTION_FLIP_BOTTOM_THRESHOLD : false
  if (shouldPin && viewport) {
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    markQuestionFlow(
      "flip-pin",
      {
        capturedBottomGap: snapshot.viewport ? Math.round(snapshot.viewport.bottomGap) : "none",
        ...questionFlowViewportMetrics(viewport, "viewport"),
      },
      { sessionID: snapshot.sessionID, requestID: snapshot.requestID },
    )
  }

  const last = rectOf(target)
  markQuestionFlow(
    "flip-play",
    {
      dx: Math.round(snapshot.rect.left - last.left),
      dy: Math.round(snapshot.rect.top - last.top),
      firstHeight: Math.round(snapshot.rect.height),
      lastHeight: Math.round(last.height),
      ...questionFlowElementMetrics(target, "target"),
    },
    { sessionID: snapshot.sessionID, requestID: snapshot.requestID },
  )
  animateTarget(target, snapshot.rect, last)
  return true
}
