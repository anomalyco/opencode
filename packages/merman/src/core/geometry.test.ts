import { describe, expect, test } from "bun:test"
import {
  diagramBoundsFromBounds,
  diagramBoundsFromPoints,
  diagramBoundsFromRect,
  boundsSidePoint,
  directionBetween,
  lane,
  orthogonalPath,
  orthogonalPathPoints,
  pathThrough,
  pathViaLane,
  point,
  translateDiagramBounds,
  walkOrthogonalSegment,
} from "./geometry.js"

describe("diagram geometry", () => {
  test("directions are only defined for orthogonal point pairs", () => {
    expect(directionBetween(point(1, 2), point(5, 2))).toBe("right")
    expect(directionBetween(point(1, 2), point(1, 0))).toBe("up")
    expect(directionBetween(point(1, 2), point(5, 4))).toBeUndefined()
    expect(directionBetween(point(1, 2), point(1, 2))).toBeUndefined()
  })

  test("bounds side points describe border and outside ports", () => {
    const bounds = { left: 10, top: 4, width: 8, height: 5, centerX: 14, centerY: 6 }

    expect(boundsSidePoint(bounds, "left", "border")).toEqual(point(10, 6))
    expect(boundsSidePoint(bounds, "left")).toEqual(point(9, 6))
    expect(boundsSidePoint(bounds, "right", "border")).toEqual(point(17, 6))
    expect(boundsSidePoint(bounds, "right")).toEqual(point(18, 6))
    expect(boundsSidePoint(bounds, "top", "border")).toEqual(point(14, 4))
    expect(boundsSidePoint(bounds, "bottom")).toEqual(point(14, 9))
  })

  test("bounds helpers create, translate, and union bounds", () => {
    const bounds = diagramBoundsFromRect(2, 3, 5, 4)

    expect(bounds).toEqual({ left: 2, top: 3, width: 5, height: 4, centerX: 4, centerY: 5 })
    translateDiagramBounds(bounds, 3, -1)
    expect(bounds).toEqual({ left: 5, top: 2, width: 5, height: 4, centerX: 7, centerY: 4 })
    expect(diagramBoundsFromBounds([bounds, diagramBoundsFromRect(0, 0, 2, 2)])).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 6,
      centerX: 5,
      centerY: 3,
    })
    expect(diagramBoundsFromPoints([point(2, 2), point(4, 5)])).toEqual({
      left: 2,
      top: 2,
      width: 3,
      height: 4,
      centerX: 3,
      centerY: 4,
    })
  })

  test("paths compose through lanes while removing duplicate joints", () => {
    expect(pathThrough([point(0, 0), point(0, 0), point(3, 0)])).toEqual([point(0, 0), point(3, 0)])
    expect(pathViaLane(point(0, 0), lane("x", 4), point(8, 3))).toEqual([
      point(0, 0),
      point(4, 0),
      point(4, 3),
      point(8, 3),
    ])
  })

  test("composed paths do not alias caller-owned points", () => {
    const start = point(0, 0)
    const end = point(8, 3)
    const firstPath = pathViaLane(start, lane("x", 4), end)
    const secondPath = pathViaLane(start, lane("x", 5), end)

    expect(firstPath[0]).not.toBe(start)
    expect(firstPath[firstPath.length - 1]).not.toBe(end)
    expect(firstPath[0]).not.toBe(secondPath[0])

    firstPath[0]!.x += 10
    firstPath[firstPath.length - 1]!.y += 10

    expect(start).toEqual(point(0, 0))
    expect(end).toEqual(point(8, 3))
    expect(secondPath[0]).toEqual(point(0, 0))
    expect(secondPath[secondPath.length - 1]).toEqual(point(8, 3))
  })

  test("orthogonal paths choose a terminal lane on the dominant axis", () => {
    expect(orthogonalPath(point(0, 0), point(10, 4))).toEqual([point(0, 0), point(6, 0), point(6, 4), point(10, 4)])
  })

  test("orthogonal segment walkers exclude endpoints", () => {
    const visited: Array<{ x: number; y: number }> = []
    walkOrthogonalSegment(point(0, 0), point(3, 0), false, (next) => {
      visited.push(next)
    })
    expect(visited).toEqual([point(1, 0), point(2, 0)])
  })

  test("orthogonal path points include endpoints without duplicating joints", () => {
    expect(orthogonalPathPoints([point(0, 0), point(3, 0), point(3, 2)])).toEqual([
      point(0, 0),
      point(1, 0),
      point(2, 0),
      point(3, 0),
      point(3, 1),
      point(3, 2),
    ])
  })
})
