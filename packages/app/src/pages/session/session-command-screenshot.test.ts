import { describe, expect, mock, test } from "bun:test"
import { createSessionScreenshotCommand } from "./session-command-screenshot"

describe("createSessionScreenshotCommand", () => {
  test("builds screenshot command metadata", () => {
    const option = createSessionScreenshotCommand({
      command: (option) => ({ ...option, category: "session" }),
      language: { t: (key) => key },
      ready: () => true,
      shot: async () => {},
    })

    expect(option.id).toBe("session.screenshot")
    expect(option.title).toBe("command.session.screenshot")
    expect(option.description).toBe("command.session.screenshot.description")
    expect(option.slash).toBe("screenshot")
    expect(option.disabled).toBe(false)
    expect(option.category).toBe("session")
  })

  test("disables command when screenshot is unavailable", () => {
    const option = createSessionScreenshotCommand({
      command: (option) => ({ ...option, category: "session" }),
      language: { t: (key) => key },
      ready: () => false,
      shot: async () => {},
    })

    expect(option.disabled).toBe(true)
  })

  test("runs screenshot action on select", async () => {
    const shot = mock(async () => {})
    const option = createSessionScreenshotCommand({
      command: (option) => ({ ...option, category: "session" }),
      language: { t: (key) => key },
      ready: () => true,
      shot,
    })

    option.onSelect?.()
    await Promise.resolve()
    expect(shot).toHaveBeenCalledTimes(1)
  })
})
