import { describe, expect, test } from "bun:test"
import * as Bom from "../../src/util/bom"

const BOM = "\uFEFF"

describe("Bom.split", () => {
  test("returns text unchanged when there is no BOM", () => {
    expect(Bom.split("hello")).toEqual({ bom: false, text: "hello" })
  })

  test("strips a single leading BOM", () => {
    expect(Bom.split(BOM + "hello")).toEqual({ bom: true, text: "hello" })
  })

  test("strips all consecutive leading BOMs", () => {
    expect(Bom.split(BOM.repeat(4) + "hello")).toEqual({ bom: true, text: "hello" })
  })

  test("does not strip a BOM that is not at the start", () => {
    expect(Bom.split("hello" + BOM)).toEqual({ bom: false, text: "hello" + BOM })
  })

  test("handles an empty string", () => {
    expect(Bom.split("")).toEqual({ bom: false, text: "" })
  })
})

describe("Bom.join", () => {
  test("adds a BOM when requested", () => {
    expect(Bom.join("hello", true)).toBe(BOM + "hello")
  })

  test("omits the BOM when not requested", () => {
    expect(Bom.join("hello", false)).toBe("hello")
  })

  test("normalizes multiple existing leading BOMs to exactly one", () => {
    expect(Bom.join(BOM.repeat(4) + "hello", true)).toBe(BOM + "hello")
  })

  test("strips all existing leading BOMs when none is requested", () => {
    expect(Bom.join(BOM.repeat(3) + "hello", false)).toBe("hello")
  })
})
