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

test.each([
  { name: "Date", value: new Date("2026-01-01T00:00:00Z") },
  { name: "Map", value: new Map([["key", "value"]]) },
  { name: "Set", value: new Set(["value"]) },
  { name: "ArrayBuffer", value: new Uint8Array([0, 255, 2]).buffer },
  { name: "DataView", value: new DataView(new Uint8Array([0, 255, 2]).buffer) },
  { name: "Blob", value: new Blob(["content"], { type: "text/plain" }) },
  { name: "File", value: new File(["content"], "test.txt", { type: "text/plain" }) },
])("preserves $name payloads at the root and inside objects and arrays", ({ value }) => {
  expect(ipcPayload(value)).toBe(value)
  const result = ipcPayload({ value, items: [value], optional: undefined }) as {
    value: unknown
    items: unknown[]
  }
  expect(result.value).toBe(value)
  expect(result.items[0]).toBe(value)
  expect(Object.hasOwn(result, "optional")).toBe(false)
})

test("omits undefined fields from objects with a null prototype", () => {
  const input = Object.setPrototypeOf({ title: undefined, name: "test" }, null)
  expect(ipcPayload({ options: input })).toStrictEqual({ options: { name: "test" } })
  expect(Object.hasOwn(input, "title")).toBe(true)
  expect(Object.getPrototypeOf(input)).toBeNull()
})

test("normalizes nested array objects and undefined elements", () => {
  expect(ipcPayload({ items: [{ title: undefined, name: "test" }, undefined] })).toStrictEqual({
    items: [{ name: "test" }, null],
  })
  expect(ipcPayload(undefined)).toBeNull()
})
