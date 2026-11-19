const out = []
out.push(await (async () => {

        const values = [1, 2, 3]
        const grouped = Object.groupBy(values, (value) => value % 2 === 0 ? "even" : "odd")
        const stringable = { toString: () => 1 }
        const coerced = Object.groupBy([1, "1", stringable], (value) => value)
        const lengths = Object.groupBy(["hello", "test", "world"], (value) => value.length)
        return [
          Object.keys(grouped), grouped.even, grouped.odd, grouped.toString === undefined,
          Object.keys(coerced), coerced[1].length,
          Object.keys(lengths), lengths[5], lengths[4],
        ]
      
})().then((v) => [0, v], (e) => [0, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const values = [-0, 0, 1, 2, 3]
        const seen = []
        Object.groupBy(values, (value, index, ...extra) => {
          seen.push([value === values[index], index, extra.length])
          return null
        })
        return seen
      
})().then((v) => [1, v], (e) => [1, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const grouped = Object.groupBy("🥰💩🙏😈", (char) => char < "🙏" ? "before" : "after")
        const empty = Object.groupBy([], () => { throw new Error("not called") })
        return [Object.keys(grouped), grouped.before, grouped.after, Object.keys(empty)]
      
})().then((v) => [2, v], (e) => [2, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const messages = []
        try { Object.groupBy({}, () => { throw new Error("not called") }) } catch (error) { messages.push(error.name) }
        for (const callback of [null, undefined, {}]) {
          try { Object.groupBy([], callback) } catch (error) { messages.push(error.name) }
        }
        try { Object.groupBy([1], () => { throw new Error("callback") }) } catch (error) { messages.push(error.message) }
        try {
          Object.groupBy([1], () => ({
            toString: () => { throw new Error("property key") },
          }))
        } catch (error) { messages.push(error.message) }
        return messages
      
})().then((v) => [3, v], (e) => [3, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const stringable = { toString: () => 1 }
        const grouped = Map.groupBy([1, "1", stringable], (value) => value)
        const parity = Map.groupBy([1, 2, 3], (value) => value % 2 === 0 ? "even" : "odd")
        const lengths = Map.groupBy(["hello", "test", "world"], (value) => value.length)
        return [
          grouped instanceof Map,
          grouped.size,
          grouped.get(1),
          grouped.get("1"),
          grouped.has(stringable),
          [...grouped.keys()].length,
          parity.get("even"),
          parity.get("odd"),
          [...lengths.keys()],
          lengths.get(5),
          lengths.get(4),
        ]
      
})().then((v) => [4, v], (e) => [4, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const values = [-0, 0, 1, 2, 3]
        const seen = []
        const grouped = Map.groupBy(values, (value, index, ...extra) => {
          seen.push([value === values[index], index, extra.length])
          return value
        })
        return [grouped.size, grouped.get(0), seen]
      
})().then((v) => [5, v], (e) => [5, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const grouped = Map.groupBy("🥰💩🙏😈", (char) => char < "🙏" ? "before" : "after")
        const empty = Map.groupBy([], () => { throw new Error("not called") })
        return [[...grouped.keys()], grouped.get("before"), grouped.get("after"), empty.size]
      
})().then((v) => [6, v], (e) => [6, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const results = []
        try { Map.groupBy({}, () => { throw new Error("not called") }) } catch (error) { results.push(error.name) }
        for (const callback of [null, undefined, {}]) {
          try { Map.groupBy([], callback) } catch (error) { results.push(error.name) }
        }
        try { Map.groupBy([1], () => { throw new Error("callback") }) }
        catch (error) { results.push(error.message) }
        return results
      
})().then((v) => [7, v], (e) => [7, "threw", e?.name, e?.message]))
return out
