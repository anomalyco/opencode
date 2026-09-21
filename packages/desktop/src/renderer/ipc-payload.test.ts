import { expect, test } from "bun:test"
import { ipcPayload } from "./ipc-payload"

test("omits undefined options without changing defined values or the input", () => {
  const input = { options: { title: undefined, multiple: false, count: 0, text: "", nullable: null } }
  expect(ipcPayload(input)).toStrictEqual({ options: { multiple: false, count: 0, text: "", nullable: null } })
  expect(Object.hasOwn(input.options, "title")).toBe(true)
})

test("preserves attachment byte views without copying their backing buffer", () => {
  const data = new Uint8Array([0, 255, 1, 2]).subarray(1, 3)
  const result = ipcPayload({ data, optional: undefined })
  expect(result).toStrictEqual({ data })
  expect((result as { data: Uint8Array }).data).toBe(data)
})

test("normalizes nested array objects and undefined elements", () => {
  expect(ipcPayload({ items: [{ title: undefined, name: "test" }, undefined] })).toStrictEqual({
    items: [{ name: "test" }, null],
  })
  expect(ipcPayload(undefined)).toBeNull()
})
