import { expect, test } from "bun:test"
import { createTimelineFollow } from "@/session/timeline/follow"
import { createRoot, createSignal } from "solid-js"

test("a session comes back where the reader left it", () => {
  createRoot((dispose) => {
    const [key, setKey] = createSignal("follow/a")
    const follow = createTimelineFollow(key)

    expect(follow.following()).toBe(true)
    follow.dispatch({ type: "detach" })

    setKey("follow/b")
    // Another session starts following: nothing remembers its viewport.
    expect(follow.following()).toBe(true)

    setKey("follow/a")
    expect(follow.following()).toBe(false)
    dispose()
  })
})

test("a session that was at its end comes back following", () => {
  createRoot((dispose) => {
    const [key, setKey] = createSignal("follow/c")
    const follow = createTimelineFollow(key)

    follow.dispatch({ type: "detach" })
    follow.dispatch({ type: "follow" })
    setKey("follow/d")
    setKey("follow/c")

    expect(follow.following()).toBe(true)
    dispose()
  })
})
