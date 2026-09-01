import { expect, test } from "bun:test"
import { destinationOrigin } from "./browser-chromium"

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example")
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000")
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(url)).toBeUndefined()
  }
})
