import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import { createMemo, createSignal, mapArray, type Accessor, type Signal } from "solid-js"
import { collectSessionMedia, type MediaItem, type MentionedFiles } from "../../component/media/model"
import { keepMediaItems } from "../../component/media/strip"

export type ServerFiles = Readonly<{
  /** This machine's home directory, for `~/` paths, when the server runs here. */
  home?: string
  exists: (file: string, location: LocationRef) => Promise<boolean>
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
  // One check per file at a time. A file found stays found; one missing is checked again only when another reply
  // names it, as when a reply plans an output that a later step renders, or when the session opens again.
  const checks = new Map<string, { found: Signal<boolean>; asked: Set<string>; pending: boolean }>()
  const mentioned: MentionedFiles | undefined = files && {
    home: files.home,
    exists(file, location, messageID) {
      const check = checks.get(file) ?? { found: createSignal(false), asked: new Set<string>(), pending: false }
      checks.set(file, check)
      const [found, setFound] = check.found
      if (!check.asked.has(messageID) && !check.pending && !found()) {
        check.pending = true
        files
          .exists(file, location)
          .catch(() => false)
          .then((exists) => {
            check.pending = false
            setFound(exists)
          })
      }
      check.asked.add(messageID)
      return found()
    },
  }
  const media = mapArray(messages, (message) => createMemo(() => collectSessionMedia([message], location(), mentioned)))
  const items = () => media().flatMap((memo) => memo())
  return createMemo<readonly MediaItem[]>((previous) => keepMediaItems(previous, items()), [])
}
