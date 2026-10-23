import { describe, expect, setSystemTime, test } from "bun:test"
import { Identifier } from "@/id/id"

// Parts and messages are stored and replayed in ID order, so IDs minted by one
// process must keep their order even when the wall clock steps backward
// (NTP corrections, VM or WSL2 resume).
describe("Identifier - wall clock steps backward", () => {
  test("ascending ids keep ascending across a backward step", () => {
    const base = Date.now()
    setSystemTime(new Date(base))
    const ids = [Identifier.ascending("part")]
    setSystemTime(new Date(base - 5_000))
    ids.push(Identifier.ascending("part"), Identifier.ascending("part"))
    setSystemTime(new Date(base + 1))
    ids.push(Identifier.ascending("part"))
    setSystemTime()

    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("descending ids keep descending across a backward step", () => {
    const base = Date.now()
    setSystemTime(new Date(base))
    const ids = [Identifier.descending("session")]
    setSystemTime(new Date(base - 5_000))
    ids.push(Identifier.descending("session"))
    setSystemTime(new Date(base + 1))
    ids.push(Identifier.descending("session"))
    setSystemTime()

    expect([...ids].sort().reverse()).toEqual(ids)
  })

  test("ids minted in the same millisecond still ascend", () => {
    const base = Date.now()
    setSystemTime(new Date(base))
    const ids = [Identifier.ascending("part"), Identifier.ascending("part"), Identifier.ascending("part")]
    setSystemTime()

    expect([...ids].sort()).toEqual(ids)
  })

  test("explicit timestamps do not move the wall-clock floor", () => {
    const base = Date.now()
    setSystemTime(new Date(base))
    const before = Identifier.ascending("part")
    const given = Identifier.create("prt", "ascending", base + 10_000)
    const after = Identifier.ascending("part")
    setSystemTime()

    expect(before < given).toBe(true)
    expect(after < given).toBe(true)
    expect(Identifier.timestamp(after) - Identifier.timestamp(before)).toBeLessThan(1_000)
  })
})
