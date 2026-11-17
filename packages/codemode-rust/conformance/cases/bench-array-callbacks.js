const items = Array.from({ length: 50000 }, (_, i) => (i * 7919) % 50000)
const mapped = items.map((x) => x * 2).filter((x) => x % 3 !== 0)
const total = mapped.reduce((a, b) => a + b, 0)
const sorted = mapped.slice(0, 20000).sort((a, b) => a - b)
return [total, sorted[0], sorted[sorted.length - 1]]
