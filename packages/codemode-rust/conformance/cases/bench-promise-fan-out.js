const work = async (i) => { await null; return i * 2 }
const results = await Promise.all(Array.from({ length: 5000 }, (_, i) => work(i)))
return results.length
