const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => ({ done: false, value: 1 }),
  return: true,
}
try {
  for await (const item of iterator) break
} catch (error) {
  return error.name
}
return "missed"
