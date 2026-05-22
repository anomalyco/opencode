type NoHashScrollResult = "pending" | "restored" | "deferred" | "bottom" | "skipped"

type SessionScrollRoute = {
  sessionKey: string
  sessionID: string | undefined
}

export function createSessionScrollDefaultGuard() {
  let activeKey: string | undefined
  let activeSessionID: string | undefined
  let entry = 0
  let consumedEntry = 0
  let retryEntry = 0
  let saveEntry = 0

  const enter = (route: SessionScrollRoute) => {
    if (activeKey === route.sessionKey && activeSessionID === route.sessionID) return entry

    activeKey = route.sessionKey
    activeSessionID = route.sessionID
    entry += 1
    retryEntry = 0
    saveEntry = 0
    return entry
  }

  const canRestore = (route: SessionScrollRoute) => {
    const token = enter(route)
    return !!route.sessionID && consumedEntry !== token
  }

  const consumeDefault = (route: SessionScrollRoute) => {
    const token = enter(route)
    consumedEntry = token
    retryEntry = 0
    saveEntry = route.sessionID ? token : 0
  }

  const allowSave = (route: SessionScrollRoute) => {
    const token = enter(route)
    if (!route.sessionID) return
    saveEntry = token
  }

  const deferRestore = (route: SessionScrollRoute) => {
    const token = enter(route)
    if (!route.sessionID) return
    retryEntry = token
    saveEntry = token
  }

  const shouldRetry = (route: SessionScrollRoute) => {
    const token = enter(route)
    return !!route.sessionID && retryEntry === token
  }

  const canSave = (route: SessionScrollRoute) => {
    const token = enter(route)
    return !!route.sessionID && saveEntry === token
  }

  return {
    enter,
    canRestore,
    consumeDefault,
    allowSave,
    deferRestore,
    shouldRetry,
    canSave,
  }
}

export function resolvePendingMessage(input: {
  sessionKey: string
  pendingKey: string
  pendingMessage: string | undefined
  consumePendingMessage: (key: string) => string | undefined
  setPendingMessage: (value: string | undefined) => void
}) {
  if (input.pendingMessage) return { pendingKey: input.pendingKey, target: input.pendingMessage }
  if (input.pendingKey === input.sessionKey) return { pendingKey: input.pendingKey, target: undefined }

  const target = input.consumePendingMessage(input.sessionKey)
  if (!target) return { pendingKey: input.sessionKey, target: undefined }

  input.setPendingMessage(target)
  return { pendingKey: input.sessionKey, target }
}

export function applyNoHashScroll(input: {
  sessionKey: string
  pendingKey: string
  pendingMessage: string | undefined
  consumePendingMessage: (key: string) => string | undefined
  setPendingMessage: (value: string | undefined) => void
  canRestoreScroll?: () => boolean
  restoreScroll?: () => boolean | undefined
  consumeDefaultScroll?: () => void
  markProgrammaticScroll?: () => void
  forceScrollToBottom: () => void
  scroller: () => HTMLDivElement | undefined
  scheduleScrollState: (el: HTMLDivElement) => void
}) {
  const pending = resolvePendingMessage(input)
  if (pending.target) {
    input.consumeDefaultScroll?.()
    return { pendingKey: pending.pendingKey, result: "pending" as NoHashScrollResult }
  }

  const shouldRestore = input.restoreScroll ? (input.canRestoreScroll?.() ?? true) : false
  if (shouldRestore && input.restoreScroll) {
    const restored = input.restoreScroll()
    if (restored === undefined) return { pendingKey: pending.pendingKey, result: "deferred" as NoHashScrollResult }
    if (restored) {
      input.consumeDefaultScroll?.()
      return { pendingKey: pending.pendingKey, result: "restored" as NoHashScrollResult }
    }
  }

  if (input.restoreScroll && !shouldRestore) return { pendingKey: pending.pendingKey, result: "skipped" as NoHashScrollResult }

  input.consumeDefaultScroll?.()
  input.markProgrammaticScroll?.()
  input.forceScrollToBottom()

  const el = input.scroller()
  if (el) input.scheduleScrollState(el)

  return { pendingKey: pending.pendingKey, result: "bottom" as NoHashScrollResult }
}
