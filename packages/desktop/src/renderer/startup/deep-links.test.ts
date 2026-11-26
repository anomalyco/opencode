import { describe, expect, test } from "bun:test"
import { createDeepLinks } from "./deep-links"

describe("deep links", () => {
  test("takes the waiting links when it starts listening and again each time main says more came", async () => {
    const waiting = [
      ["opencode://open-project?directory=/a"],
      [],
      ["opencode://session/ses_b", "opencode://session/ses_c"],
    ]

    const notify: Array<() => void> = []
    const received: string[][] = []

    const stop = createDeepLinks({
      takeDeepLinks: async () => waiting.shift() ?? [],
      onDeepLink: (cb) => {
        notify.push(cb)

        return () => notify.splice(0)
      },
    })((urls) => received.push(urls))

    await Bun.sleep(0)
    notify[0]?.()
    await Bun.sleep(0)
    notify[0]?.()
    await Bun.sleep(0)

    expect(received).toEqual([
      ["opencode://open-project?directory=/a"],
      ["opencode://session/ses_b", "opencode://session/ses_c"],
    ])
    stop()
    expect(notify).toEqual([])
  })
})
