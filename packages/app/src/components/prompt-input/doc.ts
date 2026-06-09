import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { OpencodeClient, SessionActor } from "@opencode-ai/sdk/v2/client"
import { createPage, type DocActor, type DocMountInput } from "@/components/blocksuite/blocksuite-doc"
import type { FileNodeType } from "@/components/blocksuite/file-reference-block"
import type { LineRefInput } from "@/components/blocksuite/line-reference-url"
import type { DocSyncOpts } from "@/components/blocksuite/opencode-doc-source"
import { label } from "@/components/blocksuite/actor"
import { clearActor, loadActor, saveActor } from "./doc-actor"

type DocHandle = Awaited<ReturnType<typeof createPage>>

type PromptDocInput = {
  sessionID: () => string | undefined
  url: () => string
  directory: () => string
  client: OpencodeClient
  submit: () => void
  user?: () => { id: string; name: string } | undefined
}

async function register(input: PromptDocInput, sessionID: string) {
  const user = input.user?.()
  // With a ?user= param the identity is keyed by that user id (stable per user, distinct across
  // users); without it, per tab. We never force a tab/browser-stored actorID onto a user-scoped
  // identity — that would merge two different users into one. The server also de-dupes by user id.
  const stored = loadActor(sessionID, user?.id)
  const res = await input.client.session.actor.upsert({
    sessionID,
    directory: input.directory(),
    ...(stored ? { actorID: stored } : {}),
    ...(user ? { userID: user.id, name: user.name } : {}),
  })
  const actor = res.data as SessionActor | undefined
  if (!actor) throw new Error("actor registration failed")
  saveActor(sessionID, actor.actorID, user?.id)
  return actor
}

async function promptDoc(input: PromptDocInput, sessionID: string) {
  const res = await input.client.session.promptDoc({ sessionID, directory: input.directory() })
  if (!res.data?.docID) throw new Error("prompt doc lookup failed")
  return res.data
}

export function createPromptDoc(input: PromptDocInput) {
  const clientID = crypto.randomUUID()
  let handle: DocHandle | undefined
  let theme: DocMountInput["theme"] | undefined
  let locale: DocMountInput["locale"] | undefined
  let sync: DocSyncOpts | undefined
  let init = true
  let historySub: { dispose: () => void } | undefined
  let mounted: HTMLElement | undefined
  let session: string | undefined
  let live: string | undefined

  // Every operation that builds or replaces the editor handle runs through one serialized lane, so
  // they never interleave. Each call gets a generation token; after each await it checks `alive()`
  // and bails if a newer intent has superseded it. This single mechanism replaces the scattered
  // seq/mark/pending and `mounted !== el` race guards.
  let lane: Promise<unknown> = Promise.resolve()
  let generation = 0

  const serialize = <T>(task: (alive: () => boolean) => Promise<T>): Promise<T> => {
    const token = ++generation
    const run = lane.then(() => task(() => token === generation))
    lane = run.catch(() => {})
    return run
  }

  const [ready, setReady] = createSignal(false)
  const [filled, setFilled] = createSignal(false)
  const [docID, setDocID] = createSignal<string | undefined>()
  const [actor, setActor] = createSignal<SessionActor | undefined>()
  const [activeSync, setActiveSync] = createSignal<DocSyncOpts | undefined>()
  const [history, setHistory] = createStore({ undo: false, redo: false })

  const syncHistory = () => {
    if (!handle) return
    const undo = handle.canUndo()
    const redo = handle.canRedo()
    if (history.undo === undo && history.redo === redo) return
    setHistory({ undo, redo })
  }

  const syncFilled = () => {
    setFilled(handle ? !handle.empty() : false)
  }

  const bindHistory = () => {
    historySub?.dispose()
    if (!handle) return
    historySub = handle.doc.slots.historyUpdated.on(() => {
      handle?.onHistory()
      syncHistory()
      syncFilled()
    })
  }

  const drop = async () => {
    historySub?.dispose()
    historySub = undefined
    const current = handle
    handle = undefined
    setReady(false)
    setFilled(false)
    await current?.dispose()
  }

  const ensure = async (sessionID: string) => {
    const actor = await register(input, sessionID)
    setActor(actor)
    const doc = await promptDoc(input, sessionID)
    setDocID(doc.docID)
    sync = {
      docID: doc.docID,
      baseUrl: input.url(),
      directory: input.directory(),
      client: input.client,
      actorID: actor.actorID,
      name: label(actor.actorID, actor.name),
      color: actor.color,
    }
    setActiveSync(sync)
    init = true
    session = sessionID
  }

  const remount = async (
    alive: () => boolean,
    opts?: {
      sync?: DocSyncOpts
      init?: boolean
      sessionID?: string
      docID?: string
      keep?: boolean
    },
  ) => {
    const el = mounted
    const themeFn = theme
    const next = opts?.sync ?? sync
    if (!el || !themeFn || !next) return
    if (!opts?.keep) await drop()
    const current = handle
    const fresh = await createPage({
      theme: themeFn,
      locale,
      sync: next,
      init: opts?.init ?? init,
      submit: input.submit,
      onDraftChange: syncFilled,
    })
    if (!alive()) {
      await fresh.dispose()
      return
    }
    const id = opts?.docID ?? next.docID
    historySub?.dispose()
    historySub = undefined
    handle = fresh
    sync = next
    setActiveSync(next)
    init = opts?.init ?? init
    if (opts?.sessionID) session = opts.sessionID
    await fresh.attach(el)
    if (opts?.keep) await current?.dispose()
    live = id
    setDocID(id)
    setReady(true)
    syncHistory()
    syncFilled()
    bindHistory()
  }

  const pivot = (sessionID: string, next: string, opts?: { init?: boolean; force?: boolean }) => {
    if (!opts?.force && live === next && handle?.collection.id === next && sync?.docID === next)
      return Promise.resolve()
    setDocID(next)
    const should = opts?.init ?? true

    return serialize(async (alive) => {
      // Already on the target doc (a duplicate pivot that queued behind the real one) — no-op.
      if (!opts?.force && handle?.collection.id === next && session === sessionID && sync?.docID === next) return

      if (session !== sessionID || !sync) await ensure(sessionID)
      if (!alive() || !sync) return
      await remount(alive, {
        sync: { ...sync, docID: next },
        init: should,
        sessionID,
        docID: next,
      })
    })
  }

  const refresh = async (sessionID: string, opts?: { init?: boolean }) => {
    const doc = await promptDoc(input, sessionID)
    setDocID(doc.docID)
    if (live !== doc.docID || handle?.collection.id !== doc.docID || sync?.docID !== doc.docID) {
      await pivot(sessionID, doc.docID, opts)
      return doc.docID
    }
    setDocID(doc.docID)
    return doc.docID
  }

  const mount = (opts: { el: HTMLElement; theme: () => "light" | "dark"; locale?: () => string }) => {
    mounted = opts.el
    theme = opts.theme
    locale = opts.locale

    const sessionID = input.sessionID()
    if (!sessionID) return Promise.resolve()

    return serialize(async (alive) => {
      const remote = await promptDoc(input, sessionID)
      if (!alive()) return
      setDocID(remote.docID)
      if (session !== sessionID || !sync || sync.docID !== remote.docID) {
        await drop()
        if (!alive()) return
        await ensure(sessionID)
        if (!alive()) return
      }

      if (handle?.collection.id === remote.docID) {
        await handle.attach(opts.el)
        setReady(true)
        syncFilled()
        return
      }

      await remount(alive)
    })
  }

  const detach = () => {
    mounted = undefined
    theme = undefined
    locale = undefined
    // serialize() bumps the generation (cancelling any in-flight build) and queues the teardown
    // behind it, so drop() can never race a concurrent mount/pivot.
    void serialize(async () => {
      await drop()
    })
  }

  const reset = () => {
    const sessionID = session
    sync = undefined
    setActiveSync(undefined)
    init = true
    session = undefined
    live = undefined
    setActor(undefined)
    setDocID(undefined)
    if (sessionID) clearActor(sessionID)
    setHistory({ undo: false, redo: false })
    setFilled(false)
    void serialize(async () => {
      await drop()
    })
  }

  const guard = () => handle?.guard()
  const refocus = (target?: Element) => {
    if (handle) {
      handle.refocus(target)
      return
    }
    requestAnimationFrame(() => handle?.refocus(target))
  }

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

  const addFiles = async (files: File[]) => {
    const result = await Promise.all(files.map((file) => handle?.addFile(file) ?? false))
    return result.some(Boolean)
  }

  const addReference = (path: string, nodeType?: FileNodeType) => handle?.addReference(path, nodeType) ?? false

  const addLineReference = (input: LineRefInput) => handle?.addLineReference(input) ?? false

  const actors = () => {
    const list: DocActor[] = handle?.actors() ?? []
    const own = actor()
    if (!own) return list
    if (list.some((item) => item.actorID === own.actorID)) return list
    return [...list, { actorID: own.actorID, name: label(own.actorID, own.name) }]
  }

  const advance = async (id?: string) => {
    const sessionID = id ?? input.sessionID()
    if (!sessionID) return
    const res = await input.client.session.promptDoc2.advance({
      sessionID,
      directory: input.directory(),
      clientID,
    })
    const next = res.data
    if (!next?.docID) throw new Error("prompt doc advance failed")
    await pivot(sessionID, next.docID, { init: true })
    const ready = await input.client.session.promptDoc2.ready({
      sessionID,
      directory: input.directory(),
      docID: next.docID,
      clientID,
    })
    if (!ready.data?.docID) throw new Error("prompt doc ready failed")
    syncFilled()
    return next.docID
  }

  return {
    ready,
    filled,
    docID,
    sync: activeSync,
    actorID: () => actor()?.actorID,
    actorName: () => actor()?.name,
    actors,
    history,
    mount,
    detach,
    reset,
    refresh,
    pivot,
    clientID,
    guard,
    refocus,
    commitMarkdown,
    addFiles,
    addReference,
    addLineReference,
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
