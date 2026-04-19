import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, NOTIFICATION_OPEN_EVENT, setNavigate } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined as any)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("emits notification-open event", () => {
    const calls: Array<string | undefined> = []
    const handler = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      calls.push(detail?.href)
    }
    window.addEventListener(NOTIFICATION_OPEN_EVENT, handler)
    handleNotificationClick("/abc/session/123")
    window.removeEventListener(NOTIFICATION_OPEN_EVENT, handler)
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("falls back to location.assign without registered navigate", () => {
    handleNotificationClick("/abc/session/123")
    // falls back to window.location.assign — no error thrown
  })
})
