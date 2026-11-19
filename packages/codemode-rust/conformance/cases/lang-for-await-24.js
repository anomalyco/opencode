const iterator = {
  [Symbol.asyncIterator]: () => { throw "acquire" },
}
try {
  for await (const item of iterator) {}
} catch (error) {
  return error
}
return "missed"
