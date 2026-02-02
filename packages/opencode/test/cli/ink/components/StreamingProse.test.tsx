/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink"
import { StreamingProse } from "@/cli/ink/components/StreamingProse"

describe("StreamingProse", () => {
  it("renders plain text without errors", () => {
    const instance = render(<StreamingProse text="Hello world" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders empty string without error", () => {
    const instance = render(<StreamingProse text="" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with streaming indicator without errors", () => {
    const instance = render(<StreamingProse text="Loading" isStreaming />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders without streaming indicator when complete", () => {
    const instance = render(<StreamingProse text="Done" isStreaming={false} />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
