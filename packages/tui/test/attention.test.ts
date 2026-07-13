import { expect, test } from "bun:test"
import { createTuiAttention } from "../src/attention"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

test("uses the product name as the fallback notification title", async () => {
  const notifications: Array<{ message: string; title?: string }> = []
  const attention = createTuiAttention({
    renderer: {
      isDestroyed: false,
      on() {},
      off() {},
      triggerNotification(message, title) {
        notifications.push({ message, title })
        return true
      },
    },
    config: createTuiResolvedConfig({ attention: { enabled: true } }),
  })

  await attention.notify({ message: "Session done", notification: { when: "always" }, sound: false })

  expect(notifications).toEqual([{ message: "Session done", title: "OpenCode" }])
  attention.dispose()
})
