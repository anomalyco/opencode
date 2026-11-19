const values = []
for await (const item of [Promise.resolve(1), 2, new Promise((resolve) => resolve(3))]) {
  values.push(item)
}
return values
