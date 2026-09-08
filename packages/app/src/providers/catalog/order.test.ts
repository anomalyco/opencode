import { expect, test } from "bun:test"
import { popularProviders } from "./order"

test("lists OpenCode Go before Zen and other popular providers", () => {
  expect(popularProviders.slice(0, 2)).toEqual(["opencode-go", "opencode"])
})
