let closed = 0
const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => ({ done: false, value: 1 }),
  return: async () => (closed += 1, { done: true }),
}
for await (const item of iterator) break
try {
  for await (const item of iterator) throw "stop"
} catch (error) {}
return closed
