import { DocCollection } from "@blocksuite/store"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import { selectionFromLines } from "@/context/file"
import type { LineComment } from "@/context/comments"
import { isLineContextItem, type FileContextItem } from "@/context/prompt"
import { OpencodeDocSource, type DocSyncOpts } from "@/components/blocksuite/opencode-doc-source"

const GUID = "prompt-context-line-comments"

type Item = {
  id: string
  file: string
  selection: LineComment["selection"]
  comment: string
  time: number
  origin?: "review" | "file"
  preview?: string
}

type SyncInput = {
  sync: Accessor<DocSyncOpts | undefined>
  comments: Accessor<LineComment[]>
  context: {
    items: Accessor<(FileContextItem & { key: string })[]>
    replaceLineContexts: (items: FileContextItem[]) => void
  }
  replace: (comments: LineComment[]) => void
}

function selection(value: unknown) {
  if (!value || typeof value !== "object") return
  const item = value as Partial<LineComment["selection"]>
  if (typeof item.start !== "number" || typeof item.end !== "number") return
  const next: LineComment["selection"] = {
    start: item.start,
    end: item.end,
  }
  if (item.side === "additions" || item.side === "deletions") next.side = item.side
  if (item.endSide === "additions" || item.endSide === "deletions") next.endSide = item.endSide
  return next
}

function read(value: unknown) {
  if (!value || typeof value !== "object") return
  const item = value as Partial<Item>
  const sel = selection(item.selection)
  if (
    typeof item.id !== "string" ||
    typeof item.file !== "string" ||
    typeof item.comment !== "string" ||
    typeof item.time !== "number" ||
    !sel
  )
    return
  return {
    id: item.id,
    file: item.file,
    selection: sel,
    comment: item.comment,
    time: item.time,
    origin: item.origin === "review" || item.origin === "file" ? item.origin : undefined,
    preview: typeof item.preview === "string" ? item.preview : undefined,
  } satisfies Item
}

function same(a: unknown, b: Item) {
  const item = read(a)
  return item ? JSON.stringify(item) === JSON.stringify(b) : false
}

function values(map: ReturnType<InstanceType<typeof DocCollection.Y.Doc>["getMap"]>) {
  const list: Item[] = []
  map.forEach((value) => {
    const item = read(value)
    if (item) list.push(item)
  })
  return list.sort((a, b) => a.time - b.time)
}

export function createPromptContextSync(input: SyncInput) {
  type State = {
    write: VoidFunction
    stop: VoidFunction
  }

  let state: State | undefined

  const local = () => {
    const meta = new Map(
      input.context
        .items()
        .filter(isLineContextItem)
        .map((item) => [item.commentID, item] as const),
    )
    return input.comments().map((comment) => {
      const item = meta.get(comment.id)
      return {
        id: comment.id,
        file: comment.file,
        selection: { ...comment.selection },
        comment: comment.comment,
        time: comment.time,
        origin: item?.commentOrigin,
        preview: item?.preview,
      } satisfies Item
    })
  }

  const connect = (opts: DocSyncOpts) => {
    const y = DocCollection.Y
    const source = new OpencodeDocSource(opts)
    const doc = new y.Doc({ guid: GUID })
    const map = doc.getMap("items")
    let ready = false
    let closed = false
    let applying = false
    let writing = false
    let unsub: VoidFunction | undefined

    const apply = () => {
      applying = true
      const list = values(map)
      input.replace(
        list.map((item) => ({
          id: item.id,
          file: item.file,
          selection: { ...item.selection },
          comment: item.comment,
          time: item.time,
        })),
      )
      input.context.replaceLineContexts(
        list.map((item) => ({
          type: "file" as const,
          path: item.file,
          selection: selectionFromLines(item.selection),
          comment: item.comment,
          commentID: item.id,
          commentOrigin: item.origin,
          preview: item.preview,
        })),
      )
      queueMicrotask(() => {
        applying = false
      })
    }

    const write = () => {
      if (!ready || applying) return
      writing = true
      const keep = new Set<string>()
      for (const item of local()) {
        keep.add(item.id)
        if (!same(map.get(item.id), item)) map.set(item.id, item)
      }
      map.forEach((_, key) => {
        if (!keep.has(key)) map.delete(key)
      })
      writing = false
    }

    const stop = () => {
      closed = true
      unsub?.()
      source.close()
      doc.destroy()
    }

    const update = (data: Uint8Array, origin: unknown, target: InstanceType<typeof y.Doc>) => {
      if (origin === source.name) return
      void source.push(target.guid, data)
    }

    doc.on("update", update)
    map.observe(() => {
      if (writing) return
      apply()
    })

    void (async () => {
      const stop = await source.subscribe((id, data) => {
        if (id !== GUID) return
        y.applyUpdate(doc, data, source.name)
      }, () => undefined)
      if (closed) {
        stop()
        return
      }
      unsub = stop
      const next = await source.pull(GUID, y.encodeStateVector(doc))
      if (next?.data.length) y.applyUpdate(doc, next.data, source.name)
      if (closed) return
      if (map.size === 0 && local().length > 0) {
        ready = true
        write()
      } else {
        apply()
        ready = true
      }
      await source.push(GUID, y.encodeStateAsUpdate(doc))
    })()

    return { write, stop } satisfies State
  }

  createEffect(() => {
    const opts = input.sync()
    state?.stop()
    state = opts ? connect(opts) : undefined
    onCleanup(() => {
      state?.stop()
      state = undefined
    })
  })

  createEffect(() => {
    input.comments()
    input.context.items()
    state?.write()
  })
}
