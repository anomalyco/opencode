/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink"
import { StatusBar } from "@/cli/ink/components/StatusBar"

describe("StatusBar", () => {
  it("renders without errors", () => {
    const instance = render(<StatusBar agent="build" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with model", () => {
    const instance = render(<StatusBar agent="build" model="claude-3" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with idle status", () => {
    const instance = render(<StatusBar agent="build" status="idle" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with busy status", () => {
    const instance = render(<StatusBar agent="build" status="busy" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without model gracefully", () => {
    const instance = render(<StatusBar agent="plan" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with retry status", () => {
    const instance = render(<StatusBar agent="test" status="retry" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with null model gracefully", () => {
    const instance = render(<StatusBar agent="deploy" model={null} />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
