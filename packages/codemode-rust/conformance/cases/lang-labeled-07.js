const visited = []
outer: inner: for (const item of [1, 2, 3]) {
  visited.push(item)
  continue outer
}
return visited
