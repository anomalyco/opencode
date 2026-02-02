/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { InputLine } from "@/cli/ink/components/InputLine"

describe("InputLine", () => {
  it("renders without errors", () => {
    const { lastFrame } = render(<InputLine onSubmit={() => {}} />)
    lastFrame()
  })

  it("renders with custom prompt", () => {
    const { lastFrame } = render(<InputLine prompt=">>> " onSubmit={() => {}} />)
    lastFrame()
  })

  it("renders with placeholder", () => {
    const { lastFrame } = render(<InputLine onSubmit={() => {}} placeholder="Type here..." />)
    lastFrame()
  })

  it("renders with initial value", () => {
    const { lastFrame } = render(<InputLine onSubmit={() => {}} initialValue="hello" />)
    lastFrame()
  })

  it("renders when disabled", () => {
    const { lastFrame } = render(<InputLine onSubmit={() => {}} disabled />)
    lastFrame()
  })
})
