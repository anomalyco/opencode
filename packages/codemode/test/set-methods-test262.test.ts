/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Set/prototype/union/combines-sets.js
 * - test/built-ins/Set/prototype/union/combines-empty-sets.js
 * - test/built-ins/Set/prototype/union/combines-itself.js
 * - test/built-ins/Set/prototype/union/combines-same-sets.js
 * - test/built-ins/Set/prototype/union/combines-Map.js
 * - test/built-ins/Set/prototype/union/result-order.js
 * - test/built-ins/Set/prototype/union/appends-new-values.js
 * - test/built-ins/Set/prototype/union/allows-set-like-object.js
 * - test/built-ins/Set/prototype/union/size-is-a-number.js
 * - test/built-ins/Set/prototype/union/has-is-callable.js
 * - test/built-ins/Set/prototype/union/keys-is-callable.js
 * - test/built-ins/Set/prototype/union/array-throws.js
 * - test/built-ins/Set/prototype/union/converts-negative-zero.js
 * - test/built-ins/Set/prototype/union/set-like-class-mutation.js
 * - test/built-ins/Set/prototype/intersection/combines-sets.js
 * - test/built-ins/Set/prototype/intersection/combines-itself.js
 * - test/built-ins/Set/prototype/intersection/result-order.js
 * - test/built-ins/Set/prototype/intersection/size-is-a-number.js
 * - test/built-ins/Set/prototype/intersection/converts-negative-zero.js
 * - test/built-ins/Set/prototype/intersection/combines-Map.js
 * - test/built-ins/Set/prototype/intersection/allows-set-like-object.js
 * - test/built-ins/Set/prototype/intersection/set-like-class-mutation.js
 * - test/built-ins/Set/prototype/difference/combines-sets.js
 * - test/built-ins/Set/prototype/difference/combines-itself.js
 * - test/built-ins/Set/prototype/difference/result-order.js
 * - test/built-ins/Set/prototype/difference/size-is-a-number.js
 * - test/built-ins/Set/prototype/difference/converts-negative-zero.js
 * - test/built-ins/Set/prototype/difference/combines-Map.js
 * - test/built-ins/Set/prototype/difference/allows-set-like-object.js
 * - test/built-ins/Set/prototype/difference/set-like-class-mutation.js
 * - test/built-ins/Set/prototype/symmetricDifference/combines-sets.js
 * - test/built-ins/Set/prototype/symmetricDifference/combines-itself.js
 * - test/built-ins/Set/prototype/symmetricDifference/result-order.js
 * - test/built-ins/Set/prototype/symmetricDifference/size-is-a-number.js
 * - test/built-ins/Set/prototype/symmetricDifference/converts-negative-zero.js
 * - test/built-ins/Set/prototype/symmetricDifference/set-like-class-mutation.js
 * - test/built-ins/Set/prototype/symmetricDifference/combines-Map.js
 * - test/built-ins/Set/prototype/symmetricDifference/allows-set-like-object.js
 * - test/built-ins/Set/prototype/isSubsetOf/compares-sets.js
 * - test/built-ins/Set/prototype/isSubsetOf/size-is-a-number.js
 * - test/built-ins/Set/prototype/isSubsetOf/compares-Map.js
 * - test/built-ins/Set/prototype/isSubsetOf/allows-set-like-object.js
 * - test/built-ins/Set/prototype/isSubsetOf/compares-itself.js
 * - test/built-ins/Set/prototype/isSubsetOf/compares-same-sets.js
 * - test/built-ins/Set/prototype/isSubsetOf/set-like-class-mutation.js
 * - test/built-ins/Set/prototype/isSupersetOf/compares-sets.js
 * - test/built-ins/Set/prototype/isSupersetOf/size-is-a-number.js
 * - test/built-ins/Set/prototype/isSupersetOf/compares-Map.js
 * - test/built-ins/Set/prototype/isSupersetOf/allows-set-like-object.js
 * - test/built-ins/Set/prototype/isSupersetOf/compares-itself.js
 * - test/built-ins/Set/prototype/isSupersetOf/compares-same-sets.js
 * - test/built-ins/Set/prototype/isSupersetOf/converts-negative-zero.js
 * - test/built-ins/Set/prototype/isDisjointFrom/compares-sets.js
 * - test/built-ins/Set/prototype/isDisjointFrom/size-is-a-number.js
 * - test/built-ins/Set/prototype/isDisjointFrom/compares-Map.js
 * - test/built-ins/Set/prototype/isDisjointFrom/allows-set-like-object.js
 * - test/built-ins/Set/prototype/isDisjointFrom/compares-itself.js
 * - test/built-ins/Set/prototype/isDisjointFrom/compares-same-sets.js
 * - test/built-ins/Set/prototype/isDisjointFrom/converts-negative-zero.js
 * - test/built-ins/Set/prototype/isDisjointFrom/set-like-class-mutation.js
 *
 * Copyright (C) 2023 Anthony Frehner. All rights reserved.
 * Copyright (C) 2023 Anthony Frehner and Kevin Gibbons. All rights reserved.
 * Copyright (C) 2023 Kevin Gibbons. All rights reserved.
 * Copyright (C) 2023 Kevin Gibbons, Anthony Frehner. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 * Set-like `keys` methods return arrays instead of iterator objects because
 * CodeMode materializes supported iterators and does not support generators.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("Set composition Test262 parity", () => {
  test("combines Sets without mutating either operand", async () => {
    expect(
      await value(`
        const left = new Set([1, 2])
        const right = new Set([2, 3])
        const union = left.union(right)
        const intersection = left.intersection(right)
        const difference = left.difference(right)
        const symmetric = left.symmetricDifference(right)
        return [
          [...union], union instanceof Set,
          [...intersection], intersection instanceof Set,
          [...difference], difference instanceof Set,
          [...symmetric], symmetric instanceof Set,
          [...left], [...right],
          [...left.union(left)], left.union(left) !== left,
          [...left.intersection(left)], left.intersection(left) !== left,
          [...left.difference(left)], left.difference(left) !== left,
          [...left.symmetricDifference(left)], left.symmetricDifference(left) !== left,
          [...left.union(new Set())], [...new Set().union(left)],
        ]
      `),
    ).toEqual([
      [1, 2, 3],
      true,
      [2],
      true,
      [1],
      true,
      [1, 3],
      true,
      [1, 2],
      [2, 3],
      [1, 2],
      true,
      [1, 2],
      true,
      [],
      true,
      [],
      true,
      [1, 2],
      [1, 2],
    ])
  })

  test("preserves the specified result order", async () => {
    expect(
      await value(`
        return [
          [...new Set([1, 3, 5]).intersection(new Set([3, 2, 1]))],
          [...new Set([3, 2, 1, 0]).intersection(new Set([1, 3, 5]))],
          [...new Set([1, 2, 3, 4]).difference(new Set([6, 5, 3, 2]))],
          [...new Set([6, 5, 3, 2]).difference(new Set([1, 2, 3, 4]))],
          [...new Set([1, 2, 3, 4]).symmetricDifference(new Set([6, 5, 4, 3]))],
          [...new Set([2, 3]).union(new Set([1, 2]))],
          [...new Set([1, 2, -3]).union(new Set([-1, 0]))],
        ]
      `),
    ).toEqual([
      [1, 3],
      [1, 3],
      [1, 4],
      [6, 5],
      [1, 2, 6, 5],
      [2, 3, 1],
      [1, 2, -3, -1, 0],
    ])
  })

  test("accepts Maps as Set-like operands", async () => {
    expect(
      await value(`
        const set = new Set([1, 2])
        const map = new Map([[2, "two"], [3, "three"]])
        return [
          [...set.union(map)],
          [...set.intersection(map)],
          [...set.difference(map)],
          [...set.symmetricDifference(map)],
        ]
      `),
    ).toEqual([[1, 2, 3], [2], [1], [1, 3]])
  })

  test("accepts supported Set-like objects and uses the size-selected method", async () => {
    expect(
      await value(`
        const keysOnly = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [2, 3],
        }
        const hasOnly = {
          size: 2,
          has: (value) => value === 2,
          keys: () => { throw new Error("keys should not be called") },
        }
        const set = new Set([1, 2])
        return [
          [...set.union(keysOnly)],
          [...set.intersection(hasOnly)],
          [...set.difference(hasOnly)],
          [...set.symmetricDifference(keysOnly)],
        ]
      `),
    ).toEqual([[1, 2, 3], [2], [1], [1, 3]])
  })

  test("normalizes negative zero", async () => {
    expect(
      await value(`
        const setlike = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [-0],
        }
        return [
          1 / new Set([1]).union(setlike).values()[1] === Infinity,
          1 / new Set([0, 1, 2]).intersection(setlike).values()[0] === Infinity,
          [...new Set([0, 1]).difference(setlike)],
          1 / new Set([1, 2]).symmetricDifference(setlike).values()[2] === Infinity,
        ]
      `),
    ).toEqual([true, true, [1], true])
  })

  test("handles duplicate Set-like keys using receiver membership", async () => {
    expect(
      await value(`
        const other = {
          size: 4,
          has: () => { throw new Error("has should not be called") },
          keys: () => [2, 2, 3, 3],
        }
        return [...new Set([1, 2]).symmetricDifference(other)]
      `),
    ).toEqual([1, 3])
  })

  test("copies receiver data before Set-like key iteration mutates it", async () => {
    expect(
      await value(`
        const unionBase = new Set(["a", "b", "c", "d", "e"])
        const unionOther = {
          size: 2,
          has: () => { throw new Error("has should not be called") },
          keys: () => {
            unionBase.delete("b")
            unionBase.delete("c")
            unionBase.add("b")
            return ["x", "y"]
          },
        }
        const union = unionBase.union(unionOther)

        const intersectionBase = new Set(["a", "b", "c", "d", "e"])
        const intersectionOther = {
          size: 3,
          has: () => { throw new Error("has should not be called") },
          keys: () => {
            intersectionBase.delete("b")
            intersectionBase.delete("c")
            intersectionBase.add("b")
            return ["x", "b", "b"]
          },
        }
        const intersection = intersectionBase.intersection(intersectionOther)

        const differenceBase = new Set(["a", "b", "c", "d", "e"])
        const differenceOther = {
          size: 3,
          has: () => { throw new Error("has should not be called") },
          keys: () => {
            differenceBase.delete("b")
            differenceBase.delete("c")
            differenceBase.add("b")
            return ["x", "b", "b"]
          },
        }
        const difference = differenceBase.difference(differenceOther)

        const symmetricBase = new Set(["a", "b", "c", "d", "e"])
        const symmetricOther = {
          size: 4,
          has: () => { throw new Error("has should not be called") },
          keys: () => {
            symmetricBase.delete("b")
            symmetricBase.delete("c")
            symmetricBase.add("b")
            return ["x", "b", "c", "c"]
          },
        }
        const symmetric = symmetricBase.symmetricDifference(symmetricOther)

        return [
          [...union], [...unionBase],
          [...intersection], [...intersectionBase],
          [...difference], [...differenceBase],
          [...symmetric], [...symmetricBase],
        ]
      `),
    ).toEqual([
      ["a", "b", "c", "d", "e", "x", "y"],
      ["a", "d", "e", "b"],
      ["b"],
      ["a", "d", "e", "b"],
      ["a", "c", "d", "e"],
      ["a", "d", "e", "b"],
      ["a", "c", "d", "e", "x"],
      ["a", "d", "e", "b"],
    ])
  })
})

describe("Set relation Test262 parity", () => {
  test("compares Sets", async () => {
    expect(
      await value(`
        const set = new Set([1, 2])
        return [
          set.isSubsetOf(new Set([2, 3])), set.isSubsetOf(new Set([1, 2, 3])),
          set.isSupersetOf(new Set([2, 3])), set.isSupersetOf(new Set([1])),
          set.isDisjointFrom(new Set([2, 3])), set.isDisjointFrom(new Set([3])),
          new Set().isSubsetOf(set), set.isSupersetOf(new Set()), new Set().isDisjointFrom(new Set()),
          set.isSubsetOf(set), set.isSupersetOf(set), set.isDisjointFrom(set),
          set.isSubsetOf(new Set([1, 2])), set.isSupersetOf(new Set([1, 2])),
        ]
      `),
    ).toEqual([false, true, false, true, false, true, true, true, true, true, true, false, true, true])
  })

  test("compares Maps and supported Set-like objects", async () => {
    expect(
      await value(`
        const set = new Set([1, 2])
        const map = new Map([[1, "one"], [2, "two"], [3, "three"]])
        const hasOnly = {
          size: 2,
          has: (value) => value === 1 || value === 2,
          keys: () => { throw new Error("keys should not be called") },
        }
        const keysOnly = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [1],
        }
        return [
          set.isSubsetOf(map), set.isSupersetOf(map), set.isDisjointFrom(map),
          set.isSubsetOf(hasOnly), set.isSupersetOf(keysOnly), set.isDisjointFrom(hasOnly),
        ]
      `),
    ).toEqual([true, false, false, true, true, false])
  })

  test("normalizes negative zero from Set-like keys", async () => {
    expect(
      await value(`
        const setlike = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [-0],
        }
        return [
          new Set([0, 1]).isSupersetOf(setlike),
          new Set([0, 1]).isDisjointFrom(setlike),
        ]
      `),
    ).toEqual([true, false])
  })

  test("observes live receiver mutation while calling Set-like has", async () => {
    expect(
      await value(`
        const subset = new Set(["a", "b", "c"])
        const subsetOther = {
          size: 3,
          has: (item) => {
            if (item === "a") subset.delete("c")
            return ["x", "a", "b"].includes(item)
          },
          keys: () => { throw new Error("keys should not be called") },
        }
        const disjoint = new Set(["a", "b", "c"])
        const disjointOther = {
          size: 3,
          has: (item) => {
            if (item === "a") {
              disjoint.delete("b")
              disjoint.delete("c")
              disjoint.add("b")
            }
            if (item === "c") throw new Error("deleted value should not be visited")
            return false
          },
          keys: () => { throw new Error("keys should not be called") },
        }
        return [
          subset.isSubsetOf(subsetOther), [...subset],
          disjoint.isDisjointFrom(disjointOther), [...disjoint],
        ]
      `),
    ).toEqual([true, ["a", "b"], true, ["a", "b"]])
  })
})

describe("Set-like validation Test262 parity", () => {
  test("rejects arrays, invalid sizes, and non-callable methods with TypeError", async () => {
    expect(
      await value(`
        const set = new Set([1])
        const names = []
        let coercionCalls = 0
        const invalid = [
          [],
          { size: undefined, has: () => false, keys: () => [] },
          { size: NaN, has: () => false, keys: () => [] },
          { size: { valueOf: () => { coercionCalls += 1; return NaN } }, has: () => false, keys: () => [] },
          { size: "string", has: () => false, keys: () => [] },
          { size: 0, has: undefined, keys: () => [] },
          { size: 0, has: {}, keys: () => [] },
          { size: 0, has: () => false, keys: undefined },
          { size: 0, has: () => false, keys: {} },
        ]
        for (const other of invalid) {
          try { set.union(other) } catch (error) { names.push(error.name) }
        }
        return [names, coercionCalls]
      `),
    ).toEqual([
      [
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
        "TypeError",
      ],
      1,
    ])
  })

  test("validates Set-like records for every method", async () => {
    expect(
      await value(`
        const set = new Set([1])
        const invalid = { size: NaN, has: () => false, keys: () => [] }
        const names = []
        const operations = [
          () => set.union(invalid),
          () => set.intersection(invalid),
          () => set.difference(invalid),
          () => set.symmetricDifference(invalid),
          () => set.isSubsetOf(invalid),
          () => set.isSupersetOf(invalid),
          () => set.isDisjointFrom(invalid),
        ]
        for (const operation of operations) {
          try { operation() } catch (error) { names.push(error.name) }
        }
        return names
      `),
    ).toEqual(["TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError"])
  })

  test("requires Set-like keys to return CodeMode's materialized iterator representation", async () => {
    expect(
      await value(`
        const set = new Set([1])
        const names = []
        for (const keys of [() => "ab", () => new Set([2]), () => new Map([[2, true]])]) {
          try { set.union({ size: 1, has: () => false, keys }) } catch (error) { names.push(error.name) }
        }
        return names
      `),
    ).toEqual(["TypeError", "TypeError", "TypeError"])
  })
})
