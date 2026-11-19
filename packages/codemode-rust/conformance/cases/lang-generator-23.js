async function* direct() { yield Promise.reject("direct") }
async function* delegated() { yield* [Promise.reject("delegated"), "unreachable"] }
const results = []
for (const iterator of [direct(), delegated()]) {
  try { await iterator.next() } catch (error) { results.push(error) }
  results.push(await iterator.next())
}
return results
