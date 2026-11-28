import { createMemo, createSignal, untrack, type Accessor } from "solid-js"
import { createFollowState, followAnchor, isFollowing, transitionFollow, type FollowEvent } from "./machine"
import { recallScroll, rememberScroll } from "./scroll-memory"

// Each session gets a fresh machine, restored from what that session remembered: a view that comes back to a session
// the reader had scrolled up in stays where they left it instead of following the newest content. Reading the state
// recomputes it for a changed key, whatever order the flush runs its computations in.
export function createTimelineFollow(sessionKey: Accessor<string>) {
  const machine = createMemo(() => {
    return createSignal(createFollowState(recallScroll(sessionKey())?.following !== false))
  })

  const state = () => machine()[0]()
  const peek = () => untrack(state)
  const following = createMemo(() => isFollowing(state()))
  const anchor = createMemo(() => followAnchor(state()))
  let attempts = 0

  // The signal skips an unchanged state, which the transition returns as the same object.
  const dispatch = (event: FollowEvent) => {
    const current = peek()
    const next = transitionFollow(current, event)

    if (next === current) return
    // Remember whether this session follows, so coming back to it resumes the same reading position.
    if (isFollowing(next) !== isFollowing(current))
      rememberScroll(untrack(sessionKey), { following: isFollowing(next) })
    untrack(machine)[1](next)
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
