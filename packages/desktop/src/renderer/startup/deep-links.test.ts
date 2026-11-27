import { describe, expect, test } from "bun:test"
import type { ElectronAPI } from "../api-types"
import { onDeepLinks, startDeepLinks } from "./deep-links"

describe("renderer deep links", () => {
  test("links that reach the window before the app listens are delivered to its first listener once", () => {
    const acknowledged: number[] = []
    const deliveries: Array<(delivery: { attempt: number; urls: string[] }) => void> = []

    const api: Pick<ElectronAPI, "onDeepLink" | "acknowledgeDeepLinks" | "readyDeepLinks"> = {
      onDeepLink: (cb) => {
        deliveries.push(cb)

        return () => {}
      },
      acknowledgeDeepLinks: (attempt) => acknowledged.push(attempt),
      readyDeepLinks: () => {},
    }

    startDeepLinks(api)
    deliveries.forEach((deliver) => deliver({ attempt: 1, urls: ["opencode://open-project?directory=/a"] }))

    const first: string[][] = []
    const second: string[][] = []
    const stop = onDeepLinks((urls) => first.push(urls))
    onDeepLinks((urls) => second.push(urls))
    deliveries.forEach((deliver) => deliver({ attempt: 2, urls: ["opencode://open-project?directory=/b"] }))
    stop()
    deliveries.forEach((deliver) => deliver({ attempt: 3, urls: ["opencode://open-project?directory=/c"] }))

    expect(acknowledged).toEqual([1, 2, 3])
    expect(first).toEqual([["opencode://open-project?directory=/a"], ["opencode://open-project?directory=/b"]])
    expect(second).toEqual([["opencode://open-project?directory=/b"], ["opencode://open-project?directory=/c"]])
  })
})
