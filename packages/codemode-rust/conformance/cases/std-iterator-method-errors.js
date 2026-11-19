const out = []
for (const b of [{ [Symbol.iterator]: () => 1 }, { [Symbol.iterator]: 5 }, "ab"]) {
  try { for (const x of b) out.push(x) } catch (e) { out.push(e.message) }
  try { out.push([...b].length) } catch (e) { out.push(e.message) }
  try { out.push(Array.from(b).length) } catch (e) { out.push(e.message) }
  try { const [x] = b; out.push(x) } catch (e) { out.push(e.message) }
  try { out.push(new Set(b).size) } catch (e) { out.push(e.message) }
}
out.push(await Promise.all("ab"))
return out
