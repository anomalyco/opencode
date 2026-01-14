import { describe, it, expect } from "vitest"
import { List } from "./list"
import { render, screen } from "@testing-library/solid"
import { createSignal } from "solid-js"

describe("List Component", () => {
  it("handles special characters in keys without querySelector errors", () => {
    const items = [
      { id: "file name with spaces.md", name: "File with Spaces" },
      { id: "file'with'quotes.md", name: "File with Quotes" },
      { id: "file#with#hashes.md", name: "File with Hashes" },
      { id: "file@with@ats.md", name: "File with @ Symbols" },
      { id: "file$with$dollars.md", name: "File with $ Symbols" },
      { id: "file^with^carets.md", name: "File with ^ Symbols" },
      { id: "file&with&amps.md", name: "File with & Symbols" },
      { id: "中国文件名.md", name: "Chinese File Name" },
    ]

    const [current, setCurrent] = createSignal(items[0])
    const [active, setActive] = createSignal(items[0].id)

    render(() => (
      <List
        items={items}
        key={(item) => item.id}
        current={current()}
        active={active()}
        onSelect={(item) => setCurrent(item!)}
      >
        {(item) => <div>{item.name}</div>}
      </List>
    ))

    // Verify all items are rendered
    items.forEach((item) => {
      expect(screen.getByText(item.name)).toBeInTheDocument()
    })

    // Simulate selecting different items to trigger scrollIntoView
    items.forEach((item) => {
      setCurrent(item)
      setActive(item.id)
      // The component should handle these without throwing errors
    })
  })
})
