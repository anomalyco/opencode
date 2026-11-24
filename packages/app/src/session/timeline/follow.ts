import { createMemo, createSignal, untrack, type Accessor } from "solid-js"
import { createFollowState, followAnchor, isFollowing, transitionFollow, type FollowEvent } from "./machine"
import { placeOf } from "./place"

// A reader who scrolled up, as the machine has it. They come back in this state to a session they had left the end of.
const away = transitionFollow(createFollowState(), { type: "scroll.intent", upward: true, overflow: true })

// Each session has its own machine. A session whose reader left its end starts out where they were, and any other
// starts out following. Reading the state recomputes it for a changed key, so a view that mounts for a session starts
// from that session's state, whatever order the flush runs its computations in.
export function createTimelineFollow(sessionKey: Accessor<string>) {
  const machine = createMemo(() => {
    const key = sessionKey()

    return { key, signal: createSignal(placeOf(key) ? away : createFollowState()) }
  })

  const state = () => machine().signal[0]()
  const peek = () => untrack(state)
  const following = createMemo(() => isFollowing(state()))
  const anchor = createMemo(() => followAnchor(state()))
  let attempts = 0

  // The signal skips an unchanged state, which the transition returns as the same object.
  const dispatch = (event: FollowEvent) => {
    untrack(machine).signal[1](transitionFollow(peek(), event))
  }

  return {
    state,
    peek,
    following,
    anchor,
    dispatch,
    /** Queues a return to the end and returns its attempt, which the frame that scrolls hands back in `return.run`. */
    beginReturn: () => {
      attempts += 1
      dispatch({ type: "return.start", attempt: attempts })

      return attempts
    },
    /** The session this state is for. A view reads it when it is built, and keeps its reader's place under it. */
    session: () => untrack(machine).key,
  }
}

export type TimelineFollow = ReturnType<typeof createTimelineFollow>
