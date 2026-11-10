import { createMemo, createSignal, untrack, type Accessor } from "solid-js"
import { createFollowState, followAnchor, isFollowing, transitionFollow, type FollowEvent } from "./machine"

// Each session gets a fresh machine. Reading the state recomputes it for a changed key, so a view that mounts for the
// new session starts out following, whatever order the flush runs its computations in.
export function createTimelineFollow(sessionKey: Accessor<string>) {
  const machine = createMemo(() => {
    sessionKey()

    return createSignal(createFollowState())
  })

  const state = () => machine()[0]()
  const peek = () => untrack(state)
  const following = createMemo(() => isFollowing(state()))
  const anchor = createMemo(() => followAnchor(state()))
  let attempts = 0

  // The signal skips an unchanged state, which the transition returns as the same object.
  const dispatch = (event: FollowEvent) => {
    untrack(machine)[1](transitionFollow(peek(), event))
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
  }
}

export type TimelineFollow = ReturnType<typeof createTimelineFollow>
