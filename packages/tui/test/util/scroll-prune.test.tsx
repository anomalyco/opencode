import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createComputed, createSignal, For } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { compensatePruneScrollTop } from "../../src/util/scroll"

describe("compensatePruneScrollTop", () => {
  const spacer = { y: 0, height: 1 }
  const message = (id: string, y: number, height = 2) => ({ id, y, height })

  test("returns scrollTop unchanged when no oldest message was pruned", () => {
    const children = [spacer, message("m0", 1), message("m1", 4)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m0", "m1", "m2"]),
        scrollTop: 50,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(50)
  })

  test("compensates by the height of pruned content above the first surviving message", () => {
    // Spacer (1) + m0 (2) + m1 margin (1) => m1 top = 4. Pruning m0 removes
    // m0's height and the margin m1 loses as it becomes the top message.
    const children = [spacer, message("m0", 1), message("m1", 4), message("m2", 7)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m1", "m2", "m3"]),
        scrollTop: 50,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(47)
  })

  test("accounts for the first surviving message losing its top margin", () => {
    // m0 pruned; m1 was 1px below m0 and becomes the top message with no margin.
    const children = [spacer, message("m0", 1), message("m1", 4), message("m2", 7)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m1", "m2"]),
        scrollTop: 50,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(50 - (4 - 1))
  })

  test("clamps to zero and never goes below the top", () => {
    const children = [spacer, message("m0", 1), message("m1", 4)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m1"]),
        scrollTop: 2,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(0)
  })

  test("leaves scrollTop alone when already at the sticky bottom", () => {
    const children = [spacer, message("m0", 1), message("m1", 4)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m1"]),
        scrollTop: 85,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(85)
  })

  test("does nothing when no surviving message anchors the measurement", () => {
    const children = [spacer, message("m0", 1), message("m1", 4)]
    expect(
      compensatePruneScrollTop({
        children,
        messageIDs: new Set(["m9"]),
        scrollTop: 50,
        scrollHeight: 100,
        viewportHeight: 15,
      }),
    ).toBe(50)
  })
})

describe("session scroll pruning", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

  beforeEach(async () => {
    if (testSetup) testSetup.renderer.destroy()
  })

  afterEach(() => {
    if (testSetup) testSetup.renderer.destroy()
  })

  test("keeps the reading position stable when oldest messages are pruned", async () => {
    type Msg = { id: string; role: "user" | "assistant"; text: string }
    const [messages, setMessages] = createSignal<Msg[]>([])
    let scroll: ScrollBoxRenderable | undefined

    // Mirror the Session route wiring: compensation runs before the message
    // list is re-rendered so it can read the pre-prune layout. Both user
    // message boxes and assistant message wrapper boxes carry the message id
    // (the AssistantMessage route wraps its parts in `<box id={message.id}>`).
    const Wiring = () => {
      createComputed(() => {
        const list = messages()
        if (!scroll || scroll.isDestroyed) return
        const compensated = compensatePruneScrollTop({
          children: scroll.getChildren(),
          messageIDs: new Set(list.map((message) => message.id)),
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          viewportHeight: scroll.viewport.height,
        })
        if (compensated !== scroll.scrollTop) scroll.scrollTop = compensated
      })
      return (
        <scrollbox
          ref={(r) => {
            scroll = r
          }}
          width={50}
          height={15}
          stickyScroll={true}
          stickyStart="bottom"
        >
          <box height={1} />
          <For each={messages()}>
            {(msg) => (
              <box id={`msg-${msg.id}`} marginTop={1}>
                <text>{msg.text}</text>
              </box>
            )}
          </For>
        </scrollbox>
      )
    }

    testSetup = await testRender(() => <Wiring />, { width: 80, height: 24 })
    await testSetup.renderOnce()

    for (let i = 0; i < 100; i++) {
      const role = i % 2 === 0 ? "user" : "assistant"
      const lines = role === "assistant" ? 4 : 2
      const text = Array.from({ length: lines }, (_, l) => `Message ${i} line ${l}`).join("\n")
      setMessages((prev) => [...prev, { id: String(i), role, text }])
      await testSetup.renderOnce()
    }

    // User scrolls up to read a backlog.
    scroll!.scrollBy(-10)
    await testSetup.renderOnce()

    const visible = scroll!
      .getChildren()
      .filter((child) => child.id !== undefined && child.y >= 0)
      .sort((a, b) => a.y - b.y)
    const topMsg = visible[0]
    expect(topMsg).toBeDefined()
    expect(topMsg!.y).toBeGreaterThanOrEqual(0)

    // Simulate sync.tsx pruning: each new message past the 100 limit shifts the
    // oldest message off the top, alternating user and assistant messages.
    for (let i = 100; i < 106; i++) {
      const role = i % 2 === 0 ? "user" : "assistant"
      const text = role === "assistant" ? "assistant output\nline two\nline three\nline four" : `new user msg ${i}`
      setMessages((prev) => [...prev.slice(1), { id: String(i), role, text }])
      await testSetup.renderOnce()
    }

    const after = scroll!.getChildren().find((child) => child.id === topMsg.id)
    expect(after?.y).toBe(topMsg.y)
  })
})
