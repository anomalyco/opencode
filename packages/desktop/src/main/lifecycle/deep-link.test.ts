import { describe, expect, test } from "bun:test"
import { consoleReturnWindow } from "./deep-link"

describe("Console return deep links", () => {
  test("reads the originating Desktop window", () => {
    expect(consoleReturnWindow("manostech://console/authorized?window=window-a")).toBe("window-a")
    expect(consoleReturnWindow("manostech://console/authorized?window=window%20b")).toBe("window b")
  })

  test("rejects unrelated and malformed links", () => {
    expect(consoleReturnWindow("manostech://console/other?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("manostech://other/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("https://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("not a url")).toBeUndefined()
    expect(consoleReturnWindow("manostech://console/authorized")).toBeUndefined()
  })
})
