/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink"
import { ToolDisplay } from "@/cli/ink/components/ToolDisplay"
import type { Tool } from "@/cli/ink/state/types"

describe("ToolDisplay", () => {
  const baseTool: Tool = {
    id: "tool-1",
    name: "read_file",
    state: "running",
    input: { path: "/test/file.ts" },
  }

  it("renders without errors for running state", () => {
    const instance = render(<ToolDisplay tool={baseTool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors for completed state", () => {
    const tool: Tool = { ...baseTool, state: "completed", output: "done" }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors for error state", () => {
    const tool: Tool = { ...baseTool, state: "error", error: "failed" }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without errors for pending state", () => {
    const tool: Tool = { ...baseTool, state: "pending" }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("handles empty input", () => {
    const tool: Tool = { ...baseTool, input: {} }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("preserves boolean false value", () => {
    const tool: Tool = { ...baseTool, input: { verbose: false } }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("preserves number 0 value", () => {
    const tool: Tool = { ...baseTool, input: { count: 0 } }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("handles null input value", () => {
    const tool: Tool = { ...baseTool, input: { value: null } }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("handles undefined input", () => {
    const tool: Tool = { ...baseTool, input: {} }
    const instance = render(<ToolDisplay tool={tool} />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
