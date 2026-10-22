import { expect, spyOn, test } from "bun:test"
import { frameLoop } from "@opencode/ui/motion"
import { landSendFlight, prepareSendFlight } from "./send-flight"

test("distinct sends keep their lead when their first paint is delayed", () => {
  const clock = spyOn(performance, "now").mockReturnValue(0)
  const schedule = spyOn(frameLoop, "addMeasured").mockImplementation(() => () => {})
  const range = document.createRange()
  const rangeBox = spyOn(range, "getBoundingClientRect").mockReturnValue(new DOMRect(380, 780, 60, 20))
  const ranges = spyOn(document, "createRange").mockReturnValue(range)
  const root = document.createElement("div")
  const scroll = document.createElement("div")
  scroll.dataset.slot = "session-timeline-scroll"
  const viewport = document.createElement("div")
  viewport.dataset.slot = "session-timeline-visible"
  const editor = document.createElement("div")
  editor.textContent = "send"
  root.append(scroll, viewport, editor)
  document.body.append(root)
  const bubbles = [0, 100, 150].map((at, index) => {
    const bubble = document.createElement("div")
    bubble.style.cssText = "padding:8px;border-radius:12px"
    bubble.textContent = `send ${index}`
    scroll.append(bubble)
    const box = spyOn(bubble, "getBoundingClientRect").mockReturnValue(new DOMRect(1000, 300 + index * 41, 80, 36))
    clock.mockReturnValue(at)
    prepareSendFlight(`delayed-${index}`, editor)
    expect(landSendFlight(`delayed-${index}`, bubble)).toBe(true)
    return { bubble, box }
  })
  const frame = (now: number) => {
    clock.mockReturnValue(now)
    schedule.mock.calls.forEach(([read]) => read())
    schedule.mock.calls.forEach(([, write]) => write(1 / 60))
  }
  try {
    // All three messages were submitted before the renderer could paint any of their flights.
    frame(180)
    frame(197)
    const hosts = [...viewport.querySelectorAll<HTMLElement>("[data-flight]")]
    expect(hosts).toHaveLength(3)
    const tops = hosts.map((host) => Number(host.style.transform.match(/translate3d\([^,]+, ([\d.-]+)px/)![1]))
    expect(tops[1]! - tops[0]!).toBeGreaterThan(36)
    expect(tops[2]! - tops[1]!).toBeGreaterThan(36)
    Array.from({ length: 120 }, (_, index) => frame(214 + index * 17))
    expect(viewport.querySelectorAll("[data-flight]")).toHaveLength(0)
    bubbles.forEach(({ bubble }) => expect(bubble.style.opacity).toBe(""))
  } finally {
    root.remove()
    schedule.mock.calls.forEach(([, write]) => write(1 / 60))
    bubbles.forEach(({ box }) => box.mockRestore())
    ranges.mockRestore()
    rangeBox.mockRestore()
    schedule.mockRestore()
    clock.mockRestore()
  }
})
