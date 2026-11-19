import { describe, expect, test } from "bun:test"
import { sanitizeQuestion, stripToolHeader } from "../src/openai"

describe("stripToolHeader", () => {
  test("removes the OpenCode read header", () => {
    expect(stripToolHeader("Read file package.json, lines 1-21\n{\n  \"name\": \"demo\"\n}")).toBe(
      '{\n  "name": "demo"\n}',
    )
  })

  test("keeps ordinary content", () => {
    expect(stripToolHeader("const a = 1")).toBe("const a = 1")
  })
})

describe("sanitizeQuestion", () => {
  test("turns a read imperative into a neutral question", () => {
    expect(sanitizeQuestion("прочитай файл package.json и скажи имя пакета")).toBe("скажи имя пакета")
  })

  test("strips the verb without a path", () => {
    expect(sanitizeQuestion("посмотри, что делает функция sum")).toBe("что делает функция sum")
  })

  test("keeps a question that already stands alone", () => {
    expect(sanitizeQuestion("какая версия у пакета?")).toBe("какая версия у пакета?")
  })
})
