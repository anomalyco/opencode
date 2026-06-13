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
  if (reducedMotion()) return
  if (last.width <= 0 || last.height <= 0) return

  const dx = first.left - last.left
  const dy = first.top - last.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

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
  })
}

export function captureQuestionFlipSource(input: {
  requestID: string
  sessionID: string
  source: HTMLElement | undefined
}): void {
  const source = input.source
  if (!source) return
  const rect = rectOf(source)
  if (rect.width <= 0 || rect.height <= 0) return

  const snapshot: QuestionFlipSnapshot = {
    requestID: input.requestID,
    sessionID: input.sessionID,
    rect,
    viewport: viewportOf(currentViewport()),
    createdAt: performance.now(),
  }

  pending.set(snapshot.requestID, snapshot)
  recent = snapshot
}

export function playPendingQuestionFlip(input: { root: ParentNode; viewport: HTMLElement | undefined }): boolean {
  const viewport = input.viewport
  const sessionID = recent?.sessionID
  const snapshot = matchSnapshot(sessionID)
  if (!snapshot) return false

  const target = findQuestionTarget(input.root, snapshot)
  if (!target) return false
  if (target.dataset.questionFlip === "playing") return false
  if (target.dataset.questionHandoff === "answer") {
    pending.delete(snapshot.requestID)
    if (recent?.requestID === snapshot.requestID) recent = undefined
    return false
  }

  pending.delete(snapshot.requestID)
  if (recent?.requestID === snapshot.requestID) recent = undefined

  const shouldPin = snapshot.viewport ? snapshot.viewport.bottomGap <= QUESTION_FLIP_BOTTOM_THRESHOLD : false
  if (shouldPin && viewport) {
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  }

  const last = rectOf(target)
  animateTarget(target, snapshot.rect, last)
  return true
}
