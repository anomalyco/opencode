/** Longest one answer may take before it fails with Retry; a stalled connection never settles on its own. */
export const BTW_GENERATE_TIMEOUT_MS = 300_000

export type BtwChatModel = {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

/** One chat as the session store keeps it. */
export type BtwSavedChat = {
  readonly id: string
  /** The thread's first question, for a follow-up in a side chat; omitted on the first question itself. */
  readonly thread?: string
  /** How many of the thread's turns were shared with the agent; kept on the first question. */
  readonly shared?: number
  readonly question: string
  readonly answer?: string
  readonly agent?: string
  readonly model?: BtwChatModel
  readonly created?: number
  readonly duration?: number
}

type ChatInfo = {
  readonly thread?: string
  readonly question: string
  readonly created?: number
  readonly agent?: string
  readonly model?: BtwChatModel
}

/**
 * Why a chat has no answer. `interrupted` is a stored chat without an answer: a reload, closed session or disposed
 * plugin abandoned its request. `empty` is a reply without visible text (a tool call or reasoning only).
 */
export type BtwFailure =
  | { readonly reason: "interrupted" }
  | { readonly reason: "empty" }
  | { readonly reason: "timeout" }
  | { readonly reason: "error"; readonly message?: string }

/**
 * A chat this plugin instance asked or retried. Chats it never touched are read from the session store, so a chat
 * shows its question, failure and Retry before the store loads.
 */
export type BtwChat =
  | (ChatInfo & { readonly status: "running"; readonly attempt: number; readonly started: number })
  | (ChatInfo & { readonly status: "answered"; readonly answer: string; readonly duration: number })
  | (ChatInfo & { readonly status: "failed"; readonly failure: BtwFailure })

/** `issued` is the last attempt id handed out; chats are keyed by session key, then chat id. */
export type BtwState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly sessions: ReadonlyMap<string, ReadonlyMap<string, BtwChat>>
    }
  | { readonly status: "disposed" }

type ActiveState = Extract<BtwState, { status: "active" }>

export type BtwEvent =
  | {
      readonly type: "chat.asked"
      readonly sessionKey: string
      readonly id: string
      /** The first question's id when this asks a follow-up in its thread. */
      readonly thread?: string
      readonly question: string
      readonly created: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | {
      readonly type: "chat.retried"
      readonly sessionKey: string
      readonly id: string
      readonly now: number
      /** The stored chat, once the session store has loaded. */
      readonly saved?: BtwSavedChat
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | {
      readonly type: "generate.succeeded"
      readonly sessionKey: string
      readonly id: string
      readonly attempt: number
      readonly text: string
      readonly now: number
    }
  | {
      readonly type: "generate.failed"
      readonly sessionKey: string
      readonly id: string
      readonly attempt: number
      readonly message?: string
    }
  | { readonly type: "generate.timed-out"; readonly sessionKey: string; readonly id: string; readonly attempt: number }
  | { readonly type: "chat.removed"; readonly sessionKey: string; readonly id: string }
  | { readonly type: "sessions.pruned"; readonly keep: ReadonlySet<string> }
  | { readonly type: "disposed" }

/** Effects act on the session of the event that caused them. */
export type BtwEffect =
  | {
      readonly type: "persist-question"
      readonly id: string
      readonly thread?: string
      readonly question: string
      readonly created: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | { readonly type: "open-tab"; readonly id: string }
  | {
      readonly type: "generate"
      readonly id: string
      readonly thread?: string
      readonly attempt: number
      readonly question: string
      readonly timeout: number
    }
  | {
      readonly type: "persist-answer"
      readonly id: string
      readonly answer: string
      readonly duration: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | { readonly type: "delete-chat"; readonly id: string }
  /** Ends the attempt's request, if it still runs, and clears its timeout. */
  | { readonly type: "abort"; readonly attempt: number }

export type BtwTransition = {
  readonly state: BtwState
  readonly effects: readonly BtwEffect[]
}

export function createBtwState(): BtwState {
  return { status: "active", issued: 0, sessions: new Map() }
}

export function transitionBtw(state: BtwState, event: BtwEvent): BtwTransition {
  if (state.status === "disposed") return next(state)

  if (event.type === "disposed") {
    return next({ status: "disposed" }, [...state.sessions.values()].flatMap(aborts))
  }

  if (event.type === "chat.asked") return asked(state, event)

  if (event.type === "chat.retried") return retried(state, event)

  if (event.type === "chat.removed") return removed(state, event.sessionKey, event.id)

  if (event.type === "sessions.pruned") return pruned(state, event.keep)

  const chat = state.sessions.get(event.sessionKey)?.get(event.id)

  if (chat?.status !== "running" || chat.attempt !== event.attempt) return next(state)

  const info = {
    thread: chat.thread,
    question: chat.question,
    created: chat.created,
    agent: chat.agent,
    model: chat.model,
  }

  const abort: BtwEffect = { type: "abort", attempt: chat.attempt }

  if (event.type === "generate.timed-out") {
    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure: { reason: "timeout" } }), [
      abort,
    ])
  }

  if (event.type === "generate.failed") {
    const failure: BtwFailure = { reason: "error", message: event.message?.trim() || undefined }

    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure }), [abort])
  }

  const answer = event.text.trim()

  // A reply without visible text is a failure the user can retry, not an empty answer.
  if (!answer) {
    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure: { reason: "empty" } }), [
      abort,
    ])
  }

  const duration = Math.max(0, event.now - chat.started)

  return next(put(state, event.sessionKey, event.id, { ...info, status: "answered", answer, duration }), [
    abort,
    { type: "persist-answer", id: event.id, answer, duration, agent: chat.agent, model: chat.model },
  ])
}

export type BtwTabView =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly question: string }

export type BtwChatView =
  | { readonly phase: "loading" }
  | { readonly phase: "missing" }
  | (ChatInfo & { readonly phase: "running" })
  | (ChatInfo & { readonly phase: "failed"; readonly failure: BtwFailure })
  | (ChatInfo & { readonly phase: "answered"; readonly answer: string; readonly duration?: number })

/** What a chat's tab shows. `saved` is the session store's chats, undefined until it loads. */
export function btwTabView(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  id: string,
): BtwTabView {
  const chat = liveChat(state, sessionKey, id) ?? saved?.find((item) => item.id === id)

  if (chat) return { status: "ready", question: chat.question }

  return saved ? { status: "missing" } : { status: "loading" }
}

/** What a chat's panel shows. `saved` is the session store's chats, undefined until it loads. */
export function btwChatView(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  id: string,
): BtwChatView {
  const live = liveChat(state, sessionKey, id)

  if (live) {
    const info = {
      thread: live.thread,
      question: live.question,
      created: live.created,
      agent: live.agent,
      model: live.model,
    }

    if (live.status === "running") return { ...info, phase: "running" }

    if (live.status === "failed") return { ...info, phase: "failed", failure: live.failure }

    return { ...info, phase: "answered", answer: live.answer, duration: live.duration }
  }

  if (!saved) return { phase: "loading" }
  const stored = saved.find((item) => item.id === id)

  if (!stored) return { phase: "missing" }

  const info = {
    thread: stored.thread,
    question: stored.question,
    created: stored.created,
    agent: stored.agent,
    model: stored.model,
  }

  const answer = stored.answer?.trim()

  if (answer) return { ...info, phase: "answered", answer, duration: stored.duration }

  // Builds before this machine stored a blank reply as the answer.
  return { ...info, phase: "failed", failure: { reason: stored.answer === undefined ? "interrupted" : "empty" } }
}

/**
 * A thread's turns in the order they were asked: its first question, then the follow-ups that name it, from both this
 * instance and the session store, so a follow-up shows before its write lands.
 */
export function btwThreadTurns(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  id: string,
): string[] {
  const live = state.status === "active" ? [...(state.sessions.get(sessionKey) ?? new Map()).entries()] : []
  const turns = new Map<string, number>([[id, 0]])

  live.forEach(([key, chat]) => {
    if (chat.thread === id) turns.set(key, chat.created ?? 0)
  })
  saved?.forEach((chat) => {
    if (chat.thread === id && !turns.has(chat.id)) turns.set(chat.id, chat.created ?? 0)
  })

  return [...turns.entries()].toSorted((a, b) => a[1] - b[1]).map(([key]) => key)
}

function asked(state: ActiveState, event: Extract<BtwEvent, { type: "chat.asked" }>) {
  const question = event.question.trim()

  if (!question || state.sessions.get(event.sessionKey)?.has(event.id)) return next(state)
  const attempt = state.issued + 1
  const info = { thread: event.thread, question, created: event.created, agent: event.agent, model: event.model }

  return next(
    put({ ...state, issued: attempt }, event.sessionKey, event.id, {
      ...info,
      status: "running",
      attempt,
      started: event.created,
    }),
    [
      { type: "persist-question", id: event.id, ...info },
      { type: "open-tab", id: event.thread ?? event.id },
      { type: "generate", id: event.id, thread: event.thread, attempt, question, timeout: BTW_GENERATE_TIMEOUT_MS },
    ],
  )
}

// A stored chat this instance never asked (one restored after a reload) is retryable once the store has loaded.
function retried(state: ActiveState, event: Extract<BtwEvent, { type: "chat.retried" }>) {
  const live = state.sessions.get(event.sessionKey)?.get(event.id)
  const chat = live ?? (event.saved?.answer?.trim() ? undefined : event.saved)

  if (!chat || (live && live.status !== "failed")) return next(state)
  const attempt = state.issued + 1

  return next(
    put({ ...state, issued: attempt }, event.sessionKey, event.id, {
      status: "running",
      attempt,
      started: event.now,
      thread: chat.thread,
      question: chat.question,
      created: chat.created,
      agent: event.agent ?? chat.agent,
      model: event.model ?? chat.model,
    }),
    [
      {
        type: "generate",
        id: event.id,
        thread: chat.thread,
        attempt,
        question: chat.question,
        timeout: BTW_GENERATE_TIMEOUT_MS,
      },
    ],
  )
}

function removed(state: ActiveState, sessionKey: string, id: string) {
  const chats = state.sessions.get(sessionKey)
  const chat = chats?.get(id)
  const remove: BtwEffect = { type: "delete-chat", id }

  if (!chats || !chat) return next(state, [remove])
  const rest = new Map(chats)
  rest.delete(id)
  const sessions = new Map(state.sessions)

  if (rest.size === 0) sessions.delete(sessionKey)

  if (rest.size > 0) sessions.set(sessionKey, rest)

  return next(
    { ...state, sessions },
    chat.status === "running" ? [{ type: "abort", attempt: chat.attempt }, remove] : [remove],
  )
}

// A closed session's requests end; its stored chats without an answer read as interrupted when it opens again.
function pruned(state: ActiveState, keep: ReadonlySet<string>) {
  const gone = [...state.sessions.keys()].filter((key) => !keep.has(key))

  if (gone.length === 0) return next(state)

  return next(
    { ...state, sessions: new Map([...state.sessions].filter(([key]) => keep.has(key))) },
    gone.flatMap((key) => aborts(state.sessions.get(key) ?? new Map())),
  )
}

function aborts(chats: ReadonlyMap<string, BtwChat>): BtwEffect[] {
  return [...chats.values()].flatMap((chat): BtwEffect[] =>
    chat.status === "running" ? [{ type: "abort", attempt: chat.attempt }] : [],
  )
}

function liveChat(state: BtwState, sessionKey: string, id: string) {
  return state.status === "active" ? state.sessions.get(sessionKey)?.get(id) : undefined
}

function put(state: ActiveState, sessionKey: string, id: string, chat: BtwChat): ActiveState {
  const sessions = new Map(state.sessions)
  sessions.set(sessionKey, new Map(state.sessions.get(sessionKey)).set(id, chat))

  return { ...state, sessions }
}

function next(state: BtwState, effects: readonly BtwEffect[] = []): BtwTransition {
  return { state, effects }
}
