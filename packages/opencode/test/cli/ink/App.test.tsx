/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render, type Instance } from "ink"
import { App } from "@/cli/ink/App"

describe("App", () => {
  it("renders without errors", () => {
    const instance = render(<App />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("unmounts without throwing", () => {
    const instance = render(<App />)
    expect(() => instance.unmount()).not.toThrow()
  })
})
