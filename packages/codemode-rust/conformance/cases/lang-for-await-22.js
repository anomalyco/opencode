const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => ({ done: false, value: 1 }),
  return: true,
}
try {
  for await (const item of iterator) throw "body"
} catch (error) {
  return error
}
return "missed"
