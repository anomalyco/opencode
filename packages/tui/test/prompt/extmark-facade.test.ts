import { describe, test, expect } from "bun:test"
import { safeExtmarks } from "../../src/prompt/display"

function makeController() {
  const calls: string[] = []
  // function expressions + `this` use → verifies the facade binds correctly.
  const controller = {
    _marks: [] as number[],
    create(this: any) { this._marks.push(1); return this._marks.length },
    delete(this: any, id: number) { calls.push("delete"); return id > 0 },
    get() { return null },
    getAll(this: any) { return this._marks.slice().map((id: number) => ({ id, start: 0, end: 0, virtual: false, typeId: 1 })) },
    getVirtual() { return [] },
    getAtOffset() { return [] },
    getAllForTypeId() { return [] },
    registerType() { return 2 },
    getTypeId() { return null },
    getTypeName() { return null },
    getMetadataFor() { return null },
    clear() { calls.push("clear") },
    destroy() { calls.push("destroy") },
  }
  return { controller, calls }
}

describe("safeExtmarks facade", () => {
  test("omits clear and destroy", () => {
    const { controller } = makeController()
    const safe = safeExtmarks(() => ({ isDestroyed: false, extmarks: controller } as any))
    expect((safe as any).clear).toBeUndefined()
    expect((safe as any).destroy).toBeUndefined()
  })

  test("delegates with correct `this` binding", () => {
    const { controller } = makeController()
    const safe = safeExtmarks(() => ({ isDestroyed: false, extmarks: controller } as any))
    expect(safe.create({} as any)).toBe(1) // touched controller._marks via `this`
    expect(safe.getAll()).toEqual([{ id: 1, start: 0, end: 0, virtual: false, typeId: 1 }])
    expect(safe.registerType("x")).toBe(2)
  })

  test("never calls clear/destroy on the raw controller", () => {
    const { controller, calls } = makeController()
    const safe = safeExtmarks(() => ({ isDestroyed: false, extmarks: controller } as any))
    safe.create({} as any)
    expect(calls).toEqual([]) // no clear/destroy reachable
  })

  test("destroyed input: facade methods no-op safely (finding 6)", () => {
    const { controller, calls } = makeController()
    let destroyed = false
    const safe = safeExtmarks(() => ({ get isDestroyed() { return destroyed }, extmarks: controller } as any))
    destroyed = true // plugin captured `safe` before unmount, calls after
    expect(() => safe.create({} as any)).not.toThrow()
    expect(safe.getAll()).toEqual([])
    expect(safe.get(1)).toBeNull()
    expect(calls).toEqual([])
  })
})
