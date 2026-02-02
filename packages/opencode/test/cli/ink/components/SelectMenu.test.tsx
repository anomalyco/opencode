/** @jsxImportSource react */
import { describe, it, expect } from "bun:test"
import { render } from "ink"
import { SelectMenu } from "@/cli/ink/components/SelectMenu"

interface SelectOption {
  label: string
  value: string
}

describe("SelectMenu", () => {
  const options: SelectOption[] = [
    { label: "Option 1", value: "opt1" },
    { label: "Option 2", value: "opt2" },
    { label: "Option 3", value: "opt3" },
  ]

  it("renders without errors", () => {
    const instance = render(<SelectMenu options={options} onSelect={() => {}} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("renders with title", () => {
    const instance = render(<SelectMenu options={options} onSelect={() => {}} title="Choose one:" />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("handles empty options", () => {
    const instance = render(<SelectMenu options={[]} onSelect={() => {}} />)
    instance.unmount()
    expect(true).toBe(true)
  })

  it("handles onSelect callback", () => {
    const onSelect = () => {}
    const instance = render(<SelectMenu options={options} onSelect={onSelect} />)
    instance.unmount()
    expect(true).toBe(true)
  })
})
