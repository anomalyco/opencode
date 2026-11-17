const values = []
outer: for await (const item of [1, 2, 3, 4]) {
  if (item === 2) continue outer
  if (item === 4) break outer
  values.push(item)
}
return values
