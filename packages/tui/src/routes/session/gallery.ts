import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import { createMemo, createSignal, mapArray, onCleanup, type Accessor, type Signal } from "solid-js"
import { collectSessionMedia, type MediaItem, type MentionedFiles } from "../../component/media/model"
import { keepMediaItems } from "../../component/media/strip"

export type ServerFiles = Readonly<{
  /** The server runs on this machine, so it reads any of this machine's files. */
  localServer: boolean
  /** This machine's home directory, for `~/` paths, when the server runs here. */
  home?: string
  exists: (file: string, location: LocationRef) => Promise<boolean>
  /** Whether the client is connected to the server; it changes when the client reconnects. */
  connected: Accessor<boolean>
  /** Runs `retry` after `delay` ms and returns a function that cancels it; `setTimeout` by default. */
  schedule?: (retry: () => void, delay: number) => () => void
}>

// A check that fails without an answer is retried after a delay that doubles up to a minute.
const RETRY_FIRST_MS = 5_000
const RETRY_MAX_MS = 60_000

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
  // shown and the client is connected, and again when its check failed without an answer: after a delay, and once the
  // client reconnects. Asks before a check starts share it. An ask while it runs waits for one more check, shared by
  // every later ask, which checks again if that found nothing, as when a reply plans an output that a later step
  // renders.
  const checks = new Map<
    string,
    {
      found: Signal<boolean>
      retried: Signal<number>
      failures: number
      queue: Promise<unknown>
      next?: Promise<boolean>
    }
  >()
  const schedule =
    files?.schedule ??
    ((retry: () => void, delay: number) => {
      const timer = setTimeout(retry, delay)
      return () => clearTimeout(timer)
    })
  const cancels = new Set<() => void>()
  onCleanup(() => cancels.forEach((cancel) => cancel()))
  const media = mapArray(messages, (message) => {
    const asked = new Set<string>()
    const mentioned: MentionedFiles | undefined = files && {
      home: files.home,
      exists(file, location) {
        const check = checks.get(file) ?? {
          found: createSignal(false),
          retried: createSignal(0),
          failures: 0,
          queue: Promise.resolve(),
        }
        checks.set(file, check)
        const [found, setFound] = check.found
        const [retried, setRetried] = check.retried
        retried()
        if (!found() && files.connected() && !asked.has(file)) {
          asked.add(file)
          if (!check.next) {
            check.next = check.queue.then(() => {
              check.next = undefined
              return found() || files.exists(file, location)
            })
            check.queue = check.next.catch(() => {
              const cancel = schedule(
                () => {
                  cancels.delete(cancel)
                  setRetried((count) => count + 1)
                },
                Math.min(RETRY_FIRST_MS * 2 ** check.failures++, RETRY_MAX_MS),
              )
              cancels.add(cancel)
            })
          }
          check.next.then(setFound, () => asked.delete(file))
        }
        return found()
      },
    }
    return createMemo(() => collectSessionMedia([message], location(), mentioned, files?.localServer))
  })
  const items = () => media().flatMap((memo) => memo())
  return createMemo<readonly MediaItem[]>((previous) => keepMediaItems(previous, items()), [])
}
