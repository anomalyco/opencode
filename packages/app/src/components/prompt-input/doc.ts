import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createPage, type DocMountInput } from "@/components/blocksuite/blocksuite-doc"
import type { DocSyncOpts } from "@/components/blocksuite/opencode-doc-source"
import { clearActor, loadActor, saveActor } from "./doc-actor"

type DocHandle = Awaited<ReturnType<typeof createPage>>

type ActorInfo = {
  actorID: string
  name: string
  color: string
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type PromptDocInput = {
  sessionID: () => string | undefined
  url: () => string
  directory: () => string
  fetch: Fetch
}

function api(input: PromptDocInput, path: string) {
  const next = new URL(path, input.url())
  next.searchParams.set("directory", input.directory())
  return next
}

async function register(input: PromptDocInput, sessionID: string) {
  const stored = loadActor(sessionID)
  const res = await input.fetch(api(input, `/session/${sessionID}/actor`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stored ? { actorID: stored } : {}),
  })
  if (!res.ok) throw new Error("actor registration failed")
  const actor = (await res.json()) as ActorInfo
  saveActor(sessionID, actor.actorID)
  return actor
}

async function promptDoc(input: PromptDocInput, sessionID: string) {
  const res = await input.fetch(api(input, `/session/${sessionID}/prompt-doc`), { cache: "no-store" })
  if (!res.ok) throw new Error("prompt doc lookup failed")
  return (await res.json()) as { docID: string }
}

export function createPromptDoc(input: PromptDocInput) {
  const clientID = crypto.randomUUID()
  let handle: DocHandle | undefined
  let theme: DocMountInput["theme"] | undefined
  let sync: DocSyncOpts | undefined
  let init = true
  let historySub: { dispose: () => void } | undefined
  let mounted: HTMLElement | undefined
  let session: string | undefined
  let live: string | undefined
  let seq = 0
  let pending: { id: string; init: boolean; task: Promise<void> } | undefined

  const [ready, setReady] = createSignal(false)
  const [docID, setDocID] = createSignal<string | undefined>()
  const [history, setHistory] = createStore({ undo: false, redo: false })

  const syncHistory = () => {
    if (!handle) return
    const undo = handle.canUndo()
    const redo = handle.canRedo()
    if (history.undo === undo && history.redo === redo) return
    setHistory({ undo, redo })
  }

  const bindHistory = () => {
    historySub?.dispose()
    if (!handle) return
    historySub = handle.doc.slots.historyUpdated.on(() => {
      handle?.onHistory()
      syncHistory()
    })
  }

  const drop = async () => {
    historySub?.dispose()
    historySub = undefined
    const current = handle
    handle = undefined
    setReady(false)
    await current?.dispose()
  }

  const ensure = async (sessionID: string) => {
    const actor = await register(input, sessionID)
    const doc = await promptDoc(input, sessionID)
    sync = {
      docID: doc.docID,
      baseUrl: input.url(),
      directory: input.directory(),
      fetch: input.fetch,
      actorID: actor.actorID,
      name: actor.name,
      color: actor.color,
    }
    init = true
    session = sessionID
  }

  const remount = async (opts?: {
    sync?: DocSyncOpts
    init?: boolean
    sessionID?: string
    docID?: string
    keep?: boolean
    seq?: number
  }) => {
    const el = mounted
    const themeFn = theme
    const next = opts?.sync ?? sync
    if (!el || !themeFn || !next) return
    if (!opts?.keep) await drop()
    const current = handle
    const fresh = await createPage({ theme: themeFn, sync: next, init: opts?.init ?? init })
    if (opts?.seq && opts.seq !== seq) {
      await fresh.dispose()
      return
    }
    if (mounted !== el || theme !== themeFn) {
      await fresh.dispose()
      return
    }
    const id = opts?.docID ?? next.docID
    historySub?.dispose()
    historySub = undefined
    handle = fresh
    sync = next
    init = opts?.init ?? init
    if (opts?.sessionID) session = opts.sessionID
    await fresh.attach(el)
    if (opts?.keep) await current?.dispose()
    live = id
    setDocID(id)
    setReady(true)
    syncHistory()
    bindHistory()
  }

  const pivot = (sessionID: string, next: string, opts?: { init?: boolean; force?: boolean }) => {
    if (!opts?.force && live === next && handle?.collection.id === next && sync?.docID === next)
      return Promise.resolve()
    const should = opts?.init ?? true
    if (!opts?.force && pending?.id === next && (pending.init || !should)) return pending.task
    const mark = ++seq

    const run = async () => {
      if (!opts?.force && handle?.collection.id === next && session === sessionID && sync?.docID === next) return

      if (session !== sessionID || !sync) await ensure(sessionID)
      if (!sync) return
      if (mark !== seq) return
      await remount({
        sync: { ...sync, docID: next },
        init: should,
        sessionID,
        docID: next,
        seq: mark,
      })
    }
    const task = run()
    const done = task.finally(() => {
      if (pending?.task !== done) return
      pending = undefined
    })
    pending = { id: next, init: should, task: done }
    return done
  }

  const refresh = async (sessionID: string, opts?: { init?: boolean }) => {
    const doc = await promptDoc(input, sessionID)
    if (live !== doc.docID || handle?.collection.id !== doc.docID || sync?.docID !== doc.docID) {
      await pivot(sessionID, doc.docID, opts)
      return doc.docID
    }
    setDocID(doc.docID)
    return doc.docID
  }

  const mount = async (opts: { el: HTMLElement; theme: () => "light" | "dark" }) => {
    mounted = opts.el
    theme = opts.theme

    const sessionID = input.sessionID()
    if (!sessionID) return

    const remote = await promptDoc(input, sessionID)
    if (session !== sessionID || !sync || sync.docID !== remote.docID) {
      await drop()
      await ensure(sessionID)
    }

    if (handle?.collection.id === remote.docID) {
      await handle.attach(opts.el)
      setReady(true)
      return
    }

    await remount()
  }

  const detach = () => {
    void drop()
    mounted = undefined
    theme = undefined
  }

  const reset = () => {
    const sessionID = session
    detach()
    sync = undefined
    init = true
    session = undefined
    live = undefined
    setDocID(undefined)
    if (sessionID) clearActor(sessionID)
    setHistory({ undo: false, redo: false })
  }

  const guard = () => handle?.guard()

  const undo = () => {
    handle?.undo()
    syncHistory()
  }

  const redo = () => {
    handle?.redo()
    syncHistory()
  }

  const commitMarkdown = () => handle?.markdown()

  const empty = () => (handle ? handle.empty() : true)

  const advance = async () => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    const res = await input.fetch(api(input, `/session/${sessionID}/prompt-doc/advance`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientID }),
    })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.includes("application/json")) throw new Error("prompt doc advance failed")
    const next = (await res.json()) as { docID: string }
    if (!next.docID) throw new Error("prompt doc advance failed")
    await pivot(sessionID, next.docID, { init: true })
    const ready = await input.fetch(api(input, `/session/${sessionID}/prompt-doc/ready`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docID: next.docID, clientID }),
    })
    const readyType = ready.headers.get("content-type") ?? ""
    if (!ready.ok || !readyType.includes("application/json")) throw new Error("prompt doc ready failed")
    return next.docID
  }

  return {
    ready,
    docID,
    history,
    mount,
    detach,
    reset,
    refresh,
    pivot,
    clientID,
    guard,
    commitMarkdown,
    empty,
    advance,
    undo,
    redo,
    setTheme: (scheme: "light" | "dark") => handle?.setTheme(scheme),
    watchTheme: () => {
      if (!handle || !theme) return
      handle.setTheme(theme())
    },
  }
}
