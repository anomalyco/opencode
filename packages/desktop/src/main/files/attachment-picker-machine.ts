// A renderer may read each file it picked once, within the selection's byte budget. A read claims its file until it
// settles: a failed or cancelled read gives the file back, so the renderer can retry it.
export type PickedPath = { readonly status: "unread" } | { readonly status: "reading"; readonly attempt: number }

export type PickedSelection = {
  readonly sender: number
  readonly remaining: number
  readonly files: ReadonlyMap<string, PickedPath>
}

// `pickers` are native file dialogs still open, by id, with the renderer that opened them. A renderer that reloads or
// closes loses its open dialogs and selections.
export type PickedFileState =
  | {
      readonly status: "open"
      readonly nextAttempt: number
      readonly pickers: ReadonlyMap<number, number>
      readonly selections: ReadonlyMap<string, PickedSelection>
    }
  | { readonly status: "disposed" }

export type PickedFileEvent =
  | { readonly type: "picker.opened"; readonly sender: number }
  | { readonly type: "picker.closed"; readonly picker: number }
  | {
      readonly type: "selection.granted"
      readonly picker: number
      readonly token: string
      readonly paths: readonly string[]
      readonly budget: number
    }
  | { readonly type: "read.requested"; readonly sender: number; readonly token: string; readonly path: string }
  | {
      readonly type: "read.succeeded"
      readonly attempt: number
      readonly token: string
      readonly path: string
      readonly bytes: ArrayBuffer
    }
  | { readonly type: "read.failed"; readonly attempt: number; readonly token: string; readonly path: string }
  | { readonly type: "read.cancelled"; readonly attempt: number; readonly token: string; readonly path: string }
  | { readonly type: "selection.released"; readonly sender: number; readonly token: string }
  | { readonly type: "sender.cleared"; readonly sender: number }
  | { readonly type: "disposed" }

export type PickedRejectReason = "not-selected" | "size-limit" | "read-failed"

// `watch-sender` and `unwatch-sender` follow a renderer while it holds a dialog or a selection; the rest answer the
// request event that produced them.
export type PickedFileCommand =
  | { readonly type: "watch-sender"; readonly sender: number }
  | { readonly type: "unwatch-sender"; readonly sender: number }
  | { readonly type: "picker-opened"; readonly picker: number }
  | { readonly type: "granted"; readonly token: string }
  | { readonly type: "read"; readonly attempt: number; readonly maxBytes: number }
  | { readonly type: "resolve" }
  | { readonly type: "reject"; readonly reason: PickedRejectReason }

export type PickedFileTransition = {
  readonly state: PickedFileState
  readonly commands: readonly PickedFileCommand[]
}

export function createPickedFileState(): PickedFileState {
  return { status: "open", nextAttempt: 1, pickers: new Map(), selections: new Map() }
}

export function transitionPickedFiles(state: PickedFileState, event: PickedFileEvent): PickedFileTransition {
  if (state.status === "disposed") {
    if (event.type === "read.requested" || event.type === "read.succeeded" || event.type === "read.failed")
      return reject(state, "not-selected")

    return { state, commands: [] }
  }

  switch (event.type) {
    case "picker.opened": {
      const picker = state.nextAttempt
      const next = { ...state, nextAttempt: picker + 1, pickers: new Map(state.pickers).set(picker, event.sender) }

      return watched(state, next, [event.sender], [{ type: "picker-opened", picker }])
    }

    case "picker.closed": {
      const sender = state.pickers.get(event.picker)

      if (sender === undefined) return { state, commands: [] }

      return watched(state, { ...state, pickers: without(state.pickers, event.picker) }, [sender], [])
    }

    case "selection.granted": {
      const sender = state.pickers.get(event.picker)

      // The renderer that opened the dialog reloaded or closed while it was open: nothing is granted.
      if (sender === undefined) return { state, commands: [] }
      const pickers = without(state.pickers, event.picker)
      const paths = [...new Set(event.paths)]

      if (paths.length === 0) return watched(state, { ...state, pickers }, [sender], [])

      const selection: PickedSelection = {
        sender,
        remaining: event.budget,
        files: new Map(paths.map((path) => [path, UNREAD])),
      }

      return watched(
        state,
        { ...state, pickers, selections: new Map(state.selections).set(event.token, selection) },
        [sender],
        [{ type: "granted", token: event.token }],
      )
    }

    case "read.requested": {
      const selection = state.selections.get(event.token)

      if (selection?.sender !== event.sender || selection.files.get(event.path)?.status !== "unread")
        return reject(state, "not-selected")
      const attempt = state.nextAttempt

      return {
        state: {
          ...state,
          nextAttempt: attempt + 1,
          selections: withFile(state.selections, event.token, selection, event.path, { status: "reading", attempt }),
        },
        commands: [{ type: "read", attempt, maxBytes: selection.remaining }],
      }
    }

    case "read.succeeded": {
      const selection = current(state, event)

      if (!selection) return reject(state, "not-selected")

      // Reads of other files in the same selection may have spent the budget since this one started.
      if (event.bytes.byteLength > selection.remaining)
        return reject(
          { ...state, selections: withFile(state.selections, event.token, selection, event.path, UNREAD) },
          "size-limit",
        )
      const files = without(selection.files, event.path)

      const selections =
        files.size === 0
          ? without(state.selections, event.token)
          : new Map(state.selections).set(event.token, {
              ...selection,
              remaining: selection.remaining - event.bytes.byteLength,
              files,
            })

      return watched(state, { ...state, selections }, [selection.sender], [{ type: "resolve" }])
    }

    case "read.failed": {
      const selection = current(state, event)

      if (!selection) return reject(state, "not-selected")

      return reject(
        { ...state, selections: withFile(state.selections, event.token, selection, event.path, UNREAD) },
        "read-failed",
      )
    }

    case "read.cancelled": {
      const selection = current(state, event)

      if (!selection) return { state, commands: [] }

      return {
        state: { ...state, selections: withFile(state.selections, event.token, selection, event.path, UNREAD) },
        commands: [],
      }
    }

    case "selection.released": {
      if (state.selections.get(event.token)?.sender !== event.sender) return { state, commands: [] }

      return watched(state, { ...state, selections: without(state.selections, event.token) }, [event.sender], [])
    }

    case "sender.cleared": {
      if (!senderLive(state, event.sender)) return { state, commands: [] }

      return watched(
        state,
        {
          ...state,
          pickers: new Map([...state.pickers].filter((entry) => entry[1] !== event.sender)),
          selections: new Map([...state.selections].filter((entry) => entry[1].sender !== event.sender)),
        },
        [event.sender],
        [],
      )
    }

    case "disposed":
      return {
        state: { status: "disposed" },
        commands: liveSenders(state).map((sender) => ({ type: "unwatch-sender", sender })),
      }
  }
}

const UNREAD: PickedPath = Object.freeze({ status: "unread" })

type OpenState = Extract<PickedFileState, { status: "open" }>

// The selection whose file this result's attempt still claims.
function current(state: OpenState, event: { attempt: number; token: string; path: string }) {
  const selection = state.selections.get(event.token)
  const file = selection?.files.get(event.path)

  if (file?.status !== "reading" || file.attempt !== event.attempt) return undefined

  return selection
}

function senderLive(state: OpenState, sender: number) {
  return (
    [...state.pickers.values()].includes(sender) ||
    [...state.selections.values()].some((selection) => selection.sender === sender)
  )
}

function liveSenders(state: OpenState) {
  return [...new Set([...state.pickers.values(), ...[...state.selections.values()].map((item) => item.sender)])]
}

// Follows a renderer from its first dialog or selection until its last is gone.
function watched(
  previous: OpenState,
  next: OpenState,
  senders: readonly number[],
  commands: readonly PickedFileCommand[],
): PickedFileTransition {
  const changes = senders.flatMap((sender): PickedFileCommand[] => {
    const before = senderLive(previous, sender)
    const after = senderLive(next, sender)

    if (before === after) return []

    return [after ? { type: "watch-sender", sender } : { type: "unwatch-sender", sender }]
  })

  return { state: next, commands: [...changes, ...commands] }
}

function withFile(
  selections: ReadonlyMap<string, PickedSelection>,
  token: string,
  selection: PickedSelection,
  path: string,
  file: PickedPath,
) {
  return new Map(selections).set(token, { ...selection, files: new Map(selection.files).set(path, file) })
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K) {
  const next = new Map(map)
  next.delete(key)

  return next
}

function reject(state: PickedFileState, reason: PickedRejectReason): PickedFileTransition {
  return { state, commands: [{ type: "reject", reason }] }
}
