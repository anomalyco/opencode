import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { useData } from "../context"
import {
  DISPOSED_ATTACHMENT_MEDIA_EVENT,
  INITIAL_ATTACHMENT_MEDIA_STATE,
  transitionAttachmentMedia,
  viewAttachmentMedia,
  type AttachmentMediaEvent,
  type AttachmentMediaTarget,
} from "./attachment-media-machine"

/** Runs the host reads one image slot needs, for as long as the slot is mounted. */
export function createAttachmentMedia(target: Accessor<AttachmentMediaTarget>) {
  const data = useData()
  const [state, setState] = createSignal(INITIAL_ATTACHMENT_MEDIA_STATE)
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: AttachmentMediaEvent) => {
    const step = transitionAttachmentMedia(untrack(state), event)
    setState(step.state)
    step.effects.forEach((effect) => {
      if (effect.type === "cancel") {
        clearTimeout(timer)
        timer = undefined
        controller?.abort()
        controller = undefined

        return
      }

      const current = new AbortController()
      const readMedia = data.readMedia
      controller = current
      timer = setTimeout(() => dispatch({ type: "read.timed-out", attempt: effect.attempt }), effect.timeoutMs)
      // A read that resolves, rejects or throws settles its attempt.
      void Promise.resolve()
        .then(() => readMedia?.(effect.uri, effect.mime, current.signal))
        .then(
          (loaded) =>
            dispatch(
              loaded
                ? { type: "read.succeeded", attempt: effect.attempt, src: loaded }
                : { type: "read.failed", attempt: effect.attempt },
            ),
          () => dispatch({ type: "read.failed", attempt: effect.attempt }),
        )
    })
  }

  createEffect(() => dispatch({ type: "target.synced", target: target() }))
  onCleanup(() => dispatch(DISPOSED_ATTACHMENT_MEDIA_EVENT))

  return {
    view: createMemo(() => viewAttachmentMedia(state(), target())),
    retry: () => dispatch({ type: "retry.requested", target: target() }),
  }
}
