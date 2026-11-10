import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import { createMemo, createSignal, mapArray, type Accessor, type Signal } from "solid-js"
import { collectSessionMedia, type MediaItem, type MentionedFiles } from "../../component/media/model"
import { keepMediaItems } from "../../component/media/strip"

export type ServerFiles = Readonly<{
  /** This machine's home directory, for `~/` paths, when the server runs here. */
  home?: string
  exists: (file: string, location: LocationRef) => Promise<boolean>
  /** Whether the client is connected to the server; it changes when the client reconnects. */
  connected: Accessor<boolean>
}>

/**
 * The media of `messages`, in order. Each message has its own memo, so a change to one message, such as a streaming
 * part, collects only that message's media again. Kept items keep their strips' tiles. Given `files`, finished replies
 * add the existing videos their text names.
 */
export function createSessionGallery(
  messages: Accessor<readonly SessionMessageInfo[]>,
  location: Accessor<LocationRef | undefined>,
  files?: ServerFiles,
) {
  // One check per file at a time. A file found stays found. A reply asks about each file it names once while it is
  // shown and the client is connected, and again once the client reconnects when its check failed without an answer.
  // Asks before a check starts share it. An ask while it runs waits for one more check, shared by every later ask,
  // which checks again if that found nothing, as when a reply plans an output that a later step renders.
  const checks = new Map<string, { found: Signal<boolean>; queue: Promise<unknown>; next?: Promise<boolean> }>()
  const media = mapArray(messages, (message) => {
    const asked = new Set<string>()
    const mentioned: MentionedFiles | undefined = files && {
      home: files.home,
      exists(file, location) {
        const check = checks.get(file) ?? { found: createSignal(false), queue: Promise.resolve() }
        checks.set(file, check)
        const [found, setFound] = check.found
        if (!found() && files.connected() && !asked.has(file)) {
          asked.add(file)
          if (!check.next) {
            check.next = check.queue.then(() => {
              check.next = undefined
              return found() || files.exists(file, location)
            })
            check.queue = check.next.catch(() => {})
          }
          check.next.then(setFound, () => asked.delete(file))
        }
        return found()
      },
    }
    return createMemo(() => collectSessionMedia([message], location(), mentioned))
  })
  const items = () => media().flatMap((memo) => memo())
  return createMemo<readonly MediaItem[]>((previous) => keepMediaItems(previous, items()), [])
}
