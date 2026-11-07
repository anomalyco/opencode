import { describe, expect, test } from "bun:test"
import { axisDomain, linear, linePath, ticks } from "./scale"

describe("linear", () => {
  test("maps a domain onto a range", () => {
    const scale = linear([0, 10], [0, 100])
    expect(scale(0)).toBe(0)
    expect(scale(5)).toBe(50)
    expect(scale(10)).toBe(100)
  })

  test("centres a zero-width domain instead of dividing by zero", () => {
    const scale = linear([4, 4], [0, 100])
    expect(scale(4)).toBe(50)
  })

  test("inverts", () => {
    const scale = linear([0, 10], [0, 100])
    expect(scale.invert(25)).toBe(2.5)
  })
})

describe("axisDomain", () => {
  test("keeps a log axis only over a positive domain", () => {
    expect(axisDomain([1, 10, 100], { log: true }).log).toBe(true)
    expect(axisDomain([0, 10], { log: true }).log).toBe(false)
    expect(axisDomain([-5, -1], { log: true })).toEqual({ domain: [-5, 1], log: false })
    expect(axisDomain([1, 10], { declared: [0, 10], log: true })).toEqual({ domain: [0, 10], log: false })
  })

  test("keeps a declared positive log domain", () => {
    expect(axisDomain([1, 10], { declared: [1, 100], log: true })).toEqual({ domain: [1, 100], log: true })
  })

  test("normalizes a reversed declared domain", () => {
    expect(axisDomain([1, 10], { declared: [100, 1] }).domain).toEqual([1, 100])
  })

  test("falls back to a linear domain without values", () => {
    expect(axisDomain([], { log: true })).toEqual({ domain: [0, 1], log: false })
  })
})

describe("ticks", () => {
  test("returns round values within the domain", () => {
    const values = ticks([0, 100], 5)
    expect(values[0]).toBe(0)
    expect(values).toContain(60)
    expect(values[values.length - 1]).toBeLessThanOrEqual(100)
  })

  test("never loops forever on a zero span", () => {
    expect(ticks([5, 5], 5)).toEqual([5])
  })
})

describe("linePath", () => {
  test("returns an empty string for no points", () => {
    expect(linePath([])).toBe("")
  })
})
