import { batch, onCleanup } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import type { OpenCodeClient, OpenCodeEvent, SessionPromptInput } from "../promise"
import { isSeqUnavailableError } from "../promise"
import { createData } from "./data"
import type { CreateDataInput } from "./data"
import { Engine } from "./engine/engine"

type SessionApi = Pick<OpenCodeClient["session"], "snapshot" | "log" | "prompt">

// Solid's setStore path types reject readonly arrays. The store only ever
// holds deep clones it owns, so a mutable mirror of the engine view is safe.
// Shallow on purpose: a recursive mutable type either flattens tuples or
// exceeds TS instantiation depth on the recursive metadata JSON types.
type StoreSessionView = {
  -readonly [Key in keyof Engine.SessionView]: Engine.SessionView[Key] extends ReadonlyArray<infer Item>
    ? Item[]
    : Engine.SessionView[Key]
}

// Engine data is plain JSON, so a recursive copy beats structuredClone's
// serialization overhead on the small per-event subtrees the adapter clones.
function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(clone) as T
  const copy: Record<string, unknown> = {}
  for (const key in value) copy[key] = clone(value[key as keyof T])
  return copy as T
}

const ambientSessionEvents = new Set<OpenCodeEvent["type"]>([
  "session.created",
  "session.deleted",
  "session.renamed",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

/** How many recent messages a session snapshot fetch requests. */
export const SNAPSHOT_RECENT = 200

export function createEngineTransport(api: () => SessionApi): Engine.SessionTransport {
  return {
    snapshot(sessionID) {
      return api().snapshot({ sessionID, recent: SNAPSHOT_RECENT })
    },
    async *stream(sessionID, after, signal) {
      try {
        for await (const item of api().log(
          { sessionID, after, follow: true, ephemeral: true },
          signal ? { signal } : undefined,
        )) {
          if (item.type !== "session.forked") yield item
        }
      } catch (error) {
        if (isSeqUnavailableError(error)) throw new Engine.SeqUnavailable()
        throw error
      }
    },
    async submit(input) {
      try {
        await api().prompt({ ...input.request, sessionID: input.sessionID, id: input.id })
      } catch (error) {
        if (isTypedError(error)) throw new Engine.SubmitRejected(error.message)
        throw error
      }
    },
  }
}

export function createEngineData(config: CreateDataInput) {
  const legacy = createData({
    ...config,
    event: {
      on: config.event.on,
      listen(handler) {
        return config.event.listen((event) => {
          if (event.name.startsWith("session.") && !ambientSessionEvents.has(event.name)) return
          handler(event)
        })
      },
    },
  })
  const [views, setViews] = createStore<Record<string, StoreSessionView>>({})
  const engines = new Map<string, Promise<Engine.SessionEngine>>()
  const families = new Set<string>()
  const invalidated = new Set<string>()
  const failures = new Set<(failure: Engine.IntentFailure) => void>()
  const cleanups = new Set<() => void>()
  const transport = createEngineTransport(() => config.api().session)
  let connected = false

  // Reconcile mutates the store's backing tree in place, so engine state must
  // never be aliased into it and every clone must appear at exactly one store
  // path. The fold is a persistent structure — successive views share
  // references for everything unchanged — so diff the previous view by
  // identity and deep-clone only the changed subtrees. (A full-view
  // structuredClone per publish dominated the streaming hot path.) New
  // SessionView fields must be diffed here or they never propagate past the
  // first publish.
  const rendered = new Map<string, Engine.SessionView>()
  const update = (sessionID: string, view: Engine.SessionView) => {
    const previous = rendered.get(sessionID)
    rendered.set(sessionID, view)
    const sessionChanged = view.session !== previous?.session
    batch(() => {
      if (!previous) setViews(sessionID, clone(view) as StoreSessionView)
      else {
        if (sessionChanged) setViews(sessionID, "session", reconcile(clone(view.session)))
        if (view.children !== previous.children)
          setViews(sessionID, "children", reconcile(clone(view.children) as StoreSessionView["children"]))
        if (view.inbox !== previous.inbox)
          setViews(sessionID, "inbox", reconcile(clone(view.inbox) as StoreSessionView["inbox"]))
        if (view.pending !== previous.pending)
          setViews(sessionID, "pending", reconcile(clone(view.pending) as StoreSessionView["pending"]))
        if (view.seq !== previous.seq) setViews(sessionID, "seq", view.seq)
        if (view.active !== previous.active) setViews(sessionID, "active", view.active)
        if (view.deleted !== previous.deleted) setViews(sessionID, "deleted", view.deleted)
        if (view.messages !== previous.messages) {
          // Per-index writes can grow the store array but never shrink it, so
          // a shorter messages list falls back to a whole-array reconcile.
          if (view.messages.length < previous.messages.length)
            setViews(sessionID, "messages", reconcile(clone(view.messages) as StoreSessionView["messages"]))
          else
            for (let index = 0; index < view.messages.length; index++)
              if (view.messages[index] !== previous.messages[index])
                setViews(sessionID, "messages", index, reconcile(clone(view.messages[index])))
        }
      }
      if (sessionChanged) {
        const current = legacy.session.get(sessionID)
        if (!current || current.time.updated <= view.session.time.updated) {
          legacy.session.remember(clone(view.session))
        }
      }
      if (families.has(sessionID) && view.children !== previous?.children) {
        view.children.forEach((child) => legacy.session.remember(clone(child)))
      }
    })
  }

  const ensure = (sessionID: string) => {
    const existing = engines.get(sessionID)
    if (existing) return existing
    const created = Engine.createSessionEngine(sessionID, transport).then((engine) => {
      update(sessionID, engine.view())
      cleanups.add(engine.subscribe((view) => update(sessionID, view)))
      cleanups.add(engine.subscribeFailures((failure) => failures.forEach((listener) => listener(failure))))
      return engine
    })
    engines.set(sessionID, created)
    void created.catch(() => engines.delete(sessionID))
    return created
  }

  const sync = async (sessionID: string) => {
    const engine = await ensure(sessionID)
    if (invalidated.delete(sessionID)) await engine.refresh()
    await engine.ready()
  }

  cleanups.add(
    config.event.on("server.connected", () => {
      if (!connected) {
        connected = true
        return
      }
      engines.forEach((engine) => void engine.then((handle) => handle.refresh()).catch(() => undefined))
    }),
  )

  onCleanup(() => {
    cleanups.forEach((cleanup) => cleanup())
    engines.forEach((engine) => void engine.then((handle) => handle.stop()))
  })

  return {
    ...legacy,
    on: config.event.on,
    listen: config.event.listen,
    session: {
      ...legacy.session,
      async sync(sessionID: string, options?: { readonly children?: boolean }) {
        if (options?.children) families.add(sessionID)
        await sync(sessionID)
        if (!options?.children) return
        const view = views[sessionID]
        view?.children.forEach((child) => legacy.session.remember(clone(unwrap(child))))
      },
      invalidate(sessionID: string) {
        invalidated.add(sessionID)
      },
      status(sessionID: string) {
        if (views[sessionID]?.active === "running") return "running"
        return legacy.session.status(sessionID)
      },
      input: {
        list(sessionID: string) {
          return (
            views[sessionID]?.pending.filter((item) => item.type !== "compaction").map((item) => item.id) ??
            legacy.session.input.list(sessionID)
          )
        },
        has(sessionID: string, inboxID: string) {
          return (
            views[sessionID]?.pending.some((item) => item.type !== "compaction" && item.id === inboxID) ??
            legacy.session.input.has(sessionID, inboxID)
          )
        },
      },
      pending: {
        list(sessionID: string) {
          void ensure(sessionID)
          return [...(views[sessionID]?.pending ?? [])]
        },
        sync(sessionID: string) {
          return sync(sessionID)
        },
        invalidate(sessionID: string) {
          invalidated.add(sessionID)
        },
      },
      message: {
        list(sessionID: string) {
          void ensure(sessionID)
          return [...(views[sessionID]?.messages ?? [])]
        },
        get(sessionID: string, messageID: string) {
          void ensure(sessionID)
          return views[sessionID]?.messages.find((message) => message.id === messageID)
        },
        sync(sessionID: string) {
          return sync(sessionID)
        },
        invalidate(sessionID: string) {
          invalidated.add(sessionID)
        },
      },
      async prompt(input: SessionPromptInput) {
        return (await ensure(input.sessionID)).submit({
          id: input.id ?? undefined,
          text: input.text,
          files: input.files,
          agents: input.agents,
          skills: input.skills,
          metadata: input.metadata,
          delivery: input.delivery,
          resume: input.resume,
        })
      },
      failures: {
        listen(listener: (failure: Engine.IntentFailure) => void) {
          failures.add(listener)
          return () => failures.delete(listener)
        },
      },
    },
  }
}

function isTypedError(error: unknown): error is { readonly _tag: string; readonly message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    "message" in error &&
    typeof error.message === "string"
  )
}

export type EngineData = ReturnType<typeof createEngineData>
