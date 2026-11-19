const values = []
for await (const [first, ...rest] of [Promise.resolve([1, 2, 3])]) {
  values.push(first, rest)
}
return values
