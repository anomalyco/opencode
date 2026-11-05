import { expect, it } from "bun:test"
import { trafficLightsPocket } from "./traffic-lights-notch"

it("bends the closed sidebar's content panel around the traffic lights, its corner concentric with the zoom button", () => {
  // The buttons span 20–80px across and 25–39px down at 1x.
  expect(trafficLightsPocket(0, 1)).toEqual({ left: 8, right: 90, bottom: 49, top: 8, outer: 10, inner: 17 })
})

it("flattens the bend into the panel's own corner as the panel's edge reaches the pocket's", () => {
  const pocket = trafficLightsPocket(70, 1)

  expect(pocket?.outer).toBeCloseTo(10 * (12 / 27), 5)
  expect(pocket?.inner).toBeCloseTo(17 * (12 / 27), 5)
  expect(trafficLightsPocket(81.99, 1)?.outer).toBeCloseTo(0, 2)
  expect(trafficLightsPocket(82, 1)).toBeUndefined()
  expect(trafficLightsPocket(240, 1)).toBeUndefined()
})

it("stays concentric with the zoom button, which keeps its native size, under renderer zoom", () => {
  const pocket = trafficLightsPocket(0, 2)

  // At 2x the buttons are 7px across on an 11.5px pitch, the first still centered 27px across and 32px down.
  expect(pocket?.inner).toBe(13.5)
  expect(pocket && pocket.right - pocket.inner).toBe(27 + 2 * 11.5)
  expect(pocket && pocket.bottom - pocket.inner).toBe(32)
})
