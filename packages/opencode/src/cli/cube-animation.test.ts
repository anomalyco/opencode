import { Cube } from "./cube-animation"

describe("Cube", () => {
  test("should have 8 vertices", () => {
    const cube = new Cube()
    expect(cube.vertices.length).toBe(8)
  })
})
