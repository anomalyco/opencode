import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import { createMemo, mapArray, type Accessor } from "solid-js"
import { collectSessionMedia, type MediaItem } from "../../component/media/model"
import { keepMediaItems } from "../../component/media/strip"

/**
 * The media of `messages`, in order. Each message has its own memo, so a change to one message, such as a streaming
 * part, collects only that message's media again. Kept items keep their strips' tiles.
 */
export function createSessionGallery(
  messages: Accessor<readonly SessionMessageInfo[]>,
  location: Accessor<LocationRef | undefined>,
) {
  const media = mapArray(messages, (message) => createMemo(() => collectSessionMedia([message], location())))
  const items = () => media().flatMap((memo) => memo())
  return createMemo<readonly MediaItem[]>((previous) => keepMediaItems(previous, items()), [])
}
