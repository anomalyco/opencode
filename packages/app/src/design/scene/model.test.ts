import { describe, expect, test } from "bun:test"
import { addObject, createScene, interpretPrompt, parseDesignScene, type DesignScene } from "./model"

function sceneWithObjects(): { scene: DesignScene; first: string } {
  const first = addObject(createScene(), "box", [-1, 0.5, 0])
  const second = addObject(first.scene, "sphere", [1, 0.75, 0])

  return { scene: second.scene, first: first.object.id }
}

describe("design scene prompts", () => {
  test("adds a primitive with color, material and position", () => {
    const { scene } = sceneWithObjects()
    const result = interpretPrompt(scene, "add a red metal cube at 2 1 0")
    const object = result.scene.objects.at(-1)

    expect(result.ok).toBe(true)
    expect(object?.shape).toBe("box")
    expect(object?.position).toEqual([2, 1, 0])
    expect(object?.material.color).toBe("#d94545")
    expect(object?.material.metalness).toBe(0.9)
    expect(object?.material.roughness).toBe(0.25)
  })

  test("understands German shape, color and position words", () => {
    const { scene } = sceneWithObjects()
    const result = interpretPrompt(scene, "füge eine blaue kugel bei 1 2 3 hinzu")
    const object = result.scene.objects.at(-1)

    expect(result.ok).toBe(true)
    expect(object?.shape).toBe("sphere")
    expect(object?.position).toEqual([1, 2, 3])
    expect(object?.material.color).toBe("#5b8def")
  })

  test("adds capsule and torus knot primitives", () => {
    const { scene } = sceneWithObjects()
    const capsule = interpretPrompt(scene, "add a capsule")
    const knot = interpretPrompt(capsule.scene, "add a torus knot")

    expect(capsule.scene.objects.at(-1)?.shape).toBe("capsule")
    expect(knot.scene.objects.at(-1)?.shape).toBe("knot")
  })

  test("moves, rotates and scales the selected object", () => {
    const { scene, first } = sceneWithObjects()
    const moved = interpretPrompt(scene, "move it to 4 2 1", first)
    const rotated = interpretPrompt(moved.scene, "rotate it 90 0 0", first)
    const scaled = interpretPrompt(rotated.scene, "scale it by 2", first)
    const object = scaled.scene.objects.find((item) => item.id === first)

    expect(object?.position).toEqual([4, 2, 1])
    expect(object?.rotation[0]).toBeCloseTo(Math.PI / 2)
    expect(object?.scale).toEqual([2, 2, 2])
  })

  test("deletes and clears objects", () => {
    const { scene, first } = sceneWithObjects()
    const removed = interpretPrompt(scene, "delete it", first)
    const cleared = interpretPrompt(removed.scene, "clear scene")

    expect(removed.scene.objects).toHaveLength(1)
    expect(cleared.scene.objects).toHaveLength(0)
  })

  test("round-trips a persisted scene", () => {
    const { scene } = sceneWithObjects()
    const parsed = parseDesignScene(JSON.parse(JSON.stringify(scene)))

    expect(parsed).toEqual(scene)
    expect(parseDesignScene({ version: 1 })).toBeUndefined()
    expect(parseDesignScene("nope")).toBeUndefined()
  })
})
