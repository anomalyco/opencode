import { batch, createEffect, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import type { SelectedLineRange } from "@/context/file"

export type LineComment = {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
  time: number
}

type CommentFocus = { file: string; id: string }

const WORKSPACE_KEY = "__workspace__"
const MAX_COMMENT_SESSIONS = 20

type CommentStore = {
  comments: Record<string, LineComment[]>
}

function aggregate(comments: Record<string, LineComment[]>) {
  return Object.keys(comments)
    .flatMap((file) => comments[file] ?? [])
    .slice()
    .sort((a, b) => a.time - b.time)
}

function insert(items: LineComment[], next: LineComment) {
  const index = items.findIndex((item) => item.time > next.time)
  if (index < 0) return [...items, next]
  return [...items.slice(0, index), next, ...items.slice(index)]
}

function createCommentSessionState(store: Store<CommentStore>, setStore: SetStoreFunction<CommentStore>) {
  const [state, setState] = createStore({
    focus: null as CommentFocus | null,
    active: null as CommentFocus | null,
    all: aggregate(store.comments),
  })

  const setFocus = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setState("focus", value)

  const setActive = (value: CommentFocus | null | ((value: CommentFocus | null) => CommentFocus | null)) =>
    setState("active", value)

  const list = (file: string) => store.comments[file] ?? []

  const add = (input: Omit<LineComment, "id" | "time">) => {
    const next: LineComment = {
      id: crypto.randomUUID(),
      time: Date.now(),
      ...input,
    }

    batch(() => {
      setStore("comments", input.file, (items) => [...(items ?? []), next])
      setState("all", (items) => insert(items, next))
      setFocus({ file: input.file, id: next.id })
    })

    return next
  }

  const remove = (file: string, id: string) => {
    batch(() => {
      setStore("comments", file, (items) => (items ?? []).filter((item) => item.id !== id))
      setState("all", (items) => items.filter((item) => !(item.file === file && item.id === id)))
      setFocus((current) => (current?.id === id ? null : current))
    })
  }

  const clear = () => {
    batch(() => {
      setStore("comments", reconcile({}))
      setState("all", [])
      setFocus(null)
      setActive(null)
    })
  }

  return {
    list,
    all: () => state.all,
    add,
    remove,
    clear,
    focus: () => state.focus,
    setFocus,
    clearFocus: () => setFocus(null),
    active: () => state.active,
    setActive,
    clearActive: () => setActive(null),
    reindex: () => setState("all", aggregate(store.comments)),
  }
}

export function createCommentSessionForTest(comments: Record<string, LineComment[]> = {}) {
  const [store, setStore] = createStore<CommentStore>({ comments })
  return createCommentSessionState(store, setStore)
}

function createCommentSession(dir: string, id: string | undefined) {
  const legacy = `${dir}/comments${id ? "/" + id : ""}.v1`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "comments", [legacy]),
    createStore<CommentStore>({
      comments: {},
    }),
  )
  const session = createCommentSessionState(store, setStore)

  createEffect(() => {
    if (!ready()) return
    session.reindex()
  })

  return {
    ready,
    list: session.list,
    all: session.all,
    add: session.add,
    remove: session.remove,
    clear: session.clear,
    focus: session.focus,
    setFocus: session.setFocus,
    clearFocus: session.clearFocus,
    active: session.active,
    setActive: session.setActive,
    clearActive: session.clearActive,
  }
}

export const { use: useComments, provider: CommentsProvider } = createSimpleContext({
  name: "Comments",
  gate: false,
  init: () => {
    const params = useParams()
    const cache = createScopedCache(
      (key) => {
        const split = key.lastIndexOf("\n")
        const dir = split >= 0 ? key.slice(0, split) : key
        const id = split >= 0 ? key.slice(split + 1) : WORKSPACE_KEY
        return createRoot((dispose) => ({
          value: createCommentSession(dir, id === WORKSPACE_KEY ? undefined : id),
          dispose,
        }))
      },
      {
        maxEntries: MAX_COMMENT_SESSIONS,
        dispose: (entry) => entry.dispose(),
      },
    )

    onCleanup(() => cache.clear())

    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}\n${id ?? WORKSPACE_KEY}`
      return cache.get(key).value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    return {
      ready: () => session().ready(),
      list: (file: string) => session().list(file),
      all: () => session().all(),
      add: (input: Omit<LineComment, "id" | "time">) => session().add(input),
      remove: (file: string, id: string) => session().remove(file, id),
      clear: () => session().clear(),
      focus: () => session().focus(),
      setFocus: (focus: CommentFocus | null) => session().setFocus(focus),
      clearFocus: () => session().clearFocus(),
      active: () => session().active(),
      setActive: (active: CommentFocus | null) => session().setActive(active),
      clearActive: () => session().clearActive(),
    }
  },
})
