import { batch, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { Persist, persisted } from "@/utils/persist"
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

type CommentSession = ReturnType<typeof createCommentSession>

type CommentCacheEntry = {
  value: CommentSession
  dispose: VoidFunction
}

function createCommentSession(dir: string, id: string | undefined) {
  const legacy = `${dir}/comments${id ? "/" + id : ""}.v1`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "comments", [legacy]),
    createStore<{
      comments: Record<string, LineComment[]>
    }>({
      comments: {},
    }),
  )

  const [state, setState] = createStore({
    focus: null as CommentFocus | null,
    active: null as CommentFocus | null,
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
      setFocus({ file: input.file, id: next.id })
    })

    return next
  }

  const remove = (file: string, id: string) => {
    setStore("comments", file, (items) => (items ?? []).filter((x) => x.id !== id))
    setFocus((current) => (current?.id === id ? null : current))
  }

  const all = createMemo(() => {
    const files = Object.keys(store.comments)
    const items = files.flatMap((file) => store.comments[file] ?? [])
    return items.slice().sort((a, b) => a.time - b.time)
  })

  return {
    ready,
    list,
    all,
    add,
    remove,
    focus: createMemo(() => state.focus),
    setFocus,
    clearFocus: () => setFocus(null),
    active: createMemo(() => state.active),
    setActive,
    clearActive: () => setActive(null),
  }
}

export const { use: useComments, provider: CommentsProvider } = createSimpleContext({
  name: "Comments",
  gate: false,
  init: () => {
    const params = useParams()
    const cache = new Map<string, CommentCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_COMMENT_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createCommentSession(dir, id),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    return {
      ready: () => session().ready(),
      list: (file: string) => session().list(file),
      all: () => session().all(),
      add: (input: Omit<LineComment, "id" | "time">) => session().add(input),
      remove: (file: string, id: string) => session().remove(file, id),
      focus: () => session().focus(),
      setFocus: (focus: CommentFocus | null) => session().setFocus(focus),
      clearFocus: () => session().clearFocus(),
      active: () => session().active(),
      setActive: (active: CommentFocus | null) => session().setActive(active),
      clearActive: () => session().clearActive(),
    }
  },
})
