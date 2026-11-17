const out = []
out.push(await (async () => {

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
      
})().then((v) => [0, v], (e) => [0, "threw", e?.name, e?.message]))
out.push(await (async () => {

        return [
          [...new Set([1, 3, 5]).intersection(new Set([3, 2, 1]))],
          [...new Set([3, 2, 1, 0]).intersection(new Set([1, 3, 5]))],
          [...new Set([1, 2, 3, 4]).difference(new Set([6, 5, 3, 2]))],
          [...new Set([6, 5, 3, 2]).difference(new Set([1, 2, 3, 4]))],
          [...new Set([1, 2, 3, 4]).symmetricDifference(new Set([6, 5, 4, 3]))],
          [...new Set([2, 3]).union(new Set([1, 2]))],
          [...new Set([1, 2, -3]).union(new Set([-1, 0]))],
        ]
      
})().then((v) => [1, v], (e) => [1, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const set = new Set([1, 2])
        const map = new Map([[2, "two"], [3, "three"]])
        return [
          [...set.union(map)],
          [...set.intersection(map)],
          [...set.difference(map)],
          [...set.symmetricDifference(map)],
        ]
      
})().then((v) => [2, v], (e) => [2, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [3, v], (e) => [3, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const setlike = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [-0],
        }
        return [
          1 / [...new Set([1]).union(setlike)][1] === Infinity,
          1 / [...new Set([0, 1, 2]).intersection(setlike)][0] === Infinity,
          [...new Set([0, 1]).difference(setlike)],
          1 / [...new Set([1, 2]).symmetricDifference(setlike)][2] === Infinity,
        ]
      
})().then((v) => [4, v], (e) => [4, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const other = {
          size: 4,
          has: () => { throw new Error("has should not be called") },
          keys: () => [2, 2, 3, 3],
        }
        return [...new Set([1, 2]).symmetricDifference(other)]
      
})().then((v) => [5, v], (e) => [5, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [6, v], (e) => [6, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const set = new Set([1, 2])
        return [
          set.isSubsetOf(new Set([2, 3])), set.isSubsetOf(new Set([1, 2, 3])),
          set.isSupersetOf(new Set([2, 3])), set.isSupersetOf(new Set([1])),
          set.isDisjointFrom(new Set([2, 3])), set.isDisjointFrom(new Set([3])),
          new Set().isSubsetOf(set), set.isSupersetOf(new Set()), new Set().isDisjointFrom(new Set()),
          set.isSubsetOf(set), set.isSupersetOf(set), set.isDisjointFrom(set),
          set.isSubsetOf(new Set([1, 2])), set.isSupersetOf(new Set([1, 2])),
        ]
      
})().then((v) => [7, v], (e) => [7, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [8, v], (e) => [8, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const setlike = {
          size: 1,
          has: () => { throw new Error("has should not be called") },
          keys: () => [-0],
        }
        return [
          new Set([0, 1]).isSupersetOf(setlike),
          new Set([0, 1]).isDisjointFrom(setlike),
        ]
      
})().then((v) => [9, v], (e) => [9, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [10, v], (e) => [10, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [11, v], (e) => [11, "threw", e?.name, e?.message]))
out.push(await (async () => {

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
      
})().then((v) => [12, v], (e) => [12, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const set = new Set([1])
        const names = []
        for (const keys of [() => "ab", () => new Set([2]), () => new Map([[2, true]])]) {
          try { set.union({ size: 1, has: () => false, keys }) } catch (error) { names.push(error.name) }
        }
        return names
      
})().then((v) => [13, v], (e) => [13, "threw", e?.name, e?.message]))
return out
