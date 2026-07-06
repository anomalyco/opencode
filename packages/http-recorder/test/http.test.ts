import { expect, test } from "bun:test"
import { HttpRecorder } from "../src"

test("public API exposes the upstream 0.3 layer contract with the V1 compatibility alias", () => {
  expect(Object.keys(HttpRecorder).sort()).toEqual([
    "http",
    "layer",
    "layerFetch",
    "layerSocket",
    "layerWebSocketConstructor",
  ])
})
