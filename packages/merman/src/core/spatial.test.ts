import { describe, expect, test } from "bun:test"
import { SpatialIndex, spatialPathClaim, spatialRectClaim } from "./spatial.js"

const body = spatialRectClaim("body", "node:A", "body", { left: 2, top: 1, width: 4, height: 3 })
const label = spatialRectClaim("label", "edge:A-B", "label", { left: 8, top: 1, width: 5, height: 1 })
const route = spatialPathClaim("route", "edge:A-B", "route", [
  { x: 5, y: 2 },
  { x: 10, y: 2 },
])

describe("SpatialIndex", () => {
  test("composition is associative, commutative, idempotent, and has an identity", () => {
    const a = SpatialIndex.empty().add(body)
    const b = SpatialIndex.empty().add(label)
    const c = SpatialIndex.empty().add(route)

    expect(SpatialIndex.empty().overlay(a).claims).toEqual(a.claims)
    expect(a.overlay(b).claims).toEqual(b.overlay(a).claims)
    expect(a.overlay(b).overlay(c).claims).toEqual(a.overlay(b.overlay(c)).claims)
    expect(a.overlay(a).claims).toEqual(a.claims)
  })

  test("routes may share routes but cannot cross unrelated semantic bodies", () => {
    const index = SpatialIndex.empty().add(body, route)
    const crossingBody = spatialPathClaim("cross-body", "edge:C-D", "route", [
      { x: 0, y: 2 },
      { x: 8, y: 2 },
    ])
    const crossingRoute = spatialPathClaim("cross-route", "edge:C-D", "route", [
      { x: 7, y: 0 },
      { x: 7, y: 4 },
    ])

    expect(index.isFree(crossingBody)).toBe(false)
    expect(index.isFree(crossingRoute)).toBe(true)
  })

  test("declared endpoint contacts do not permit contact elsewhere", () => {
    const index = SpatialIndex.empty().add(body)
    const candidate = spatialPathClaim("candidate", "edge:B-A", "route", [
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ])

    expect(index.isFree(candidate)).toBe(false)
    expect(index.isFree(candidate, { contacts: [{ owner: "node:A", points: [{ x: 2, y: 2 }] }] })).toBe(true)
  })

  test("firstFit chooses the first collision-free candidate", () => {
    const index = SpatialIndex.empty().add(body)
    const blocked = spatialRectClaim("blocked", "label:B", "label", { left: 3, top: 2, width: 2, height: 1 })
    const clear = spatialRectClaim("clear", "label:B", "label", { left: 7, top: 2, width: 2, height: 1 })

    expect(index.firstFit([{ claim: blocked }, { claim: clear }])?.claim.id).toBe("clear")
  })

  test("clearance is symmetric in both axes", () => {
    const index = SpatialIndex.empty().add(body)
    const touchingRight = spatialRectClaim("right", "label:B", "label", { left: 6, top: 1, width: 2, height: 1 })
    const touchingBelow = spatialRectClaim("below", "label:C", "label", { left: 2, top: 4, width: 2, height: 1 })

    expect(index.isFree(touchingRight)).toBe(true)
    expect(index.isFree(touchingRight, { clearance: 1 })).toBe(false)
    expect(index.isFree(touchingBelow)).toBe(true)
    expect(index.isFree(touchingBelow, { clearance: 1 })).toBe(false)
  })

  test("axis-specific clearance does not move unrelated rows", () => {
    const index = SpatialIndex.empty().add(body)
    const touchingRight = spatialRectClaim("right", "label:B", "label", { left: 6, top: 1, width: 2, height: 1 })
    const touchingBelow = spatialRectClaim("below", "label:C", "label", { left: 2, top: 4, width: 2, height: 1 })

    expect(index.isFree(touchingRight, { clearance: { x: 1, y: 0 } })).toBe(false)
    expect(index.isFree(touchingBelow, { clearance: { x: 1, y: 0 } })).toBe(true)
  })

  test("rejects malformed geometry instead of weakening collision checks", () => {
    expect(() => spatialRectClaim("zero", "node", "body", { left: 0, top: 0, width: 0, height: 1 })).toThrow()
    expect(() =>
      spatialPathClaim("diagonal", "edge", "route", [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toThrow()
    expect(() => SpatialIndex.empty().add(body).isFree(label, { clearance: Number.POSITIVE_INFINITY })).toThrow()
  })
})
