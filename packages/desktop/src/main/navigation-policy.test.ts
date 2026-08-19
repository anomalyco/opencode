import { describe, expect, test } from "bun:test"
import { wireNavigationPolicy } from "./navigation-policy"

function setup() {
  const listeners = new Map<string, (...args: never[]) => void>()
  const opened: string[] = []
  wireNavigationPolicy(
    {
      setWindowOpenHandler: () => ({ action: "deny" as const }),
      on: (event, listener) => {
        listeners.set(event, listener as (...args: never[]) => void)
      },
    } as never,
    {
      isRendererUrl: (url) => url === "oc://renderer/index.html",
      openExternal: (url) => opened.push(url),
    },
  )

  const frame = (url: string, isMainFrame: boolean) => {
    const event = {
      url,
      isMainFrame,
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
    }
    listeners.get("will-frame-navigate")?.(event as never)
    return event
  }
  const navigate = (url: string) => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
    }
    listeners.get("will-navigate")?.(event as never, url as never)
    return event
  }

  return { frame, navigate, opened }
}

describe("window navigation policy", () => {
  test("blocks every untrusted subframe navigation without opening it while preserving main-frame handling", () => {
    const subject = setup()

    for (const url of [
      "https://visualization-e2e.invalid/self",
      "data:text/html,<script>location='https://visualization-e2e.invalid'</script>",
      "blob:https://visualization-e2e.invalid/id",
      "javascript:location='https://visualization-e2e.invalid'",
      "about:blank",
    ]) {
      expect(subject.frame(url, false).prevented).toBe(true)
    }
    expect(subject.opened).toEqual([])
    expect(subject.frame("https://visualization-e2e.invalid/main", true).prevented).toBe(false)
    expect(subject.navigate("https://visualization-e2e.invalid/main").prevented).toBe(true)
    expect(subject.opened).toEqual(["https://visualization-e2e.invalid/main"])
    expect(subject.frame("about:srcdoc", false).prevented).toBe(false)
    expect(subject.frame("oc://renderer/index.html", false).prevented).toBe(true)
  })
})
